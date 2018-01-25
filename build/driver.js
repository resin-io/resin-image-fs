
/*
Copyright 2016 Resin.io

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
 */
var Promise, SECTOR_SIZE, createDriverFromFile, createExtDriverDisposer, createFatDriverDisposer, ext2fs, fatfs, fs, partitioninfo, _;

partitioninfo = require('partitioninfo');

Promise = require('bluebird');

fs = Promise.promisifyAll(require('fs'));

fatfs = require('fatfs');

_ = require('lodash');

ext2fs = Promise.promisifyAll(require('ext2fs'));

SECTOR_SIZE = 512;

createFatDriverDisposer = function(disk, offset, size) {
  var fat, sectorPosition;
  sectorPosition = function(sector) {
    return offset + sector * SECTOR_SIZE;
  };
  fat = fatfs.createFileSystem({
    sectorSize: SECTOR_SIZE,
    numSectors: size / SECTOR_SIZE,
    readSectors: function(sector, dest, callback) {
      return disk.read(dest, 0, dest.length, sectorPosition(sector), callback);
    },
    writeSectors: function(sector, data, callback) {
      return disk.write(data, 0, data.length, sectorPosition(sector), callback);
    }
  });
  return new Promise(function(resolve, reject) {
    fat.on('error', reject);
    return fat.on('ready', function() {
      return resolve(fat);
    });
  }).then(function(fat) {
    return Promise.resolve(Promise.promisifyAll(fat)).disposer(function() {});
  });
};

createExtDriverDisposer = function(disk, offset, size) {
  return ext2fs.mountAsync(disk, {
    offset: offset
  }).then(function(fs_) {
    return Promise.resolve(Promise.promisifyAll(fs_)).disposer(function(fs_) {
      return ext2fs.umountAsync(fs_);
    });
  });
};


/**
 * @summary Get a fatfs / node-ext2fs driver from a file
 * @protected
 * @function
 *
 * @param {filedisk.Disk} disk - filedisk.Disk instance
 * @param {Number} offset - offset of the image
 * @param {Number} size - size of the image
 * @returns {disposer<Object>} a bluebird diposer of a node fs like interface
 *
 * @example
 * Promise.using openFile('my/file', 'r+'), (fd) ->
 *     disk = new filedisk.FileDisk(fd)
 *     Promise.using createDriverFromFile(disk), (driver) ->
 * 	      console.log(driver)
 */

createDriverFromFile = function(disk, offset, size, type) {
  return Promise["try"](function() {
    if (type) {
      if (type === 0x83) {
        return createExtDriverDisposer(disk, offset, size);
      } else {
        return createFatDriverDisposer(disk, offset, size);
      }
    } else {
      return createFatDriverDisposer(disk, offset, size)["catch"](function() {
        return createExtDriverDisposer(disk, offset, size);
      });
    }
  })["catch"](function() {
    throw new Error('Unsupported filesystem.');
  });
};


/**
 * @summary Get a bluebird disposer of an fs instance pointing to a FAT or ext{2,3,4} partition
 * @protected
 * @function
 *
 * @description
 * If no partition number is passed, a raw partition file is assumed.
 *
 * @param {filedisk.Disk} disk - filedisk.Disk instance
 * @param {Number} [partition] - partition number
 *
 * @returns {disposer<Object>} filesystem object
 *
 * @example
 * Promise.using filedisk.openFile('foo/bar.img', 'r+'), (fd) ->
 *     disk = new filedisk.FileDisk(fd)
 *     Promise.using driver.interact(disk, 1), (fs) ->
 * 	      fs.readdirAsync('/')
 *     .then (files) ->
 *         console.log(files)
 */

exports.interact = function(disk, partition) {
  disk = Promise.promisifyAll(disk);
  return Promise["try"](function() {
    if (_.isUndefined(partition)) {
      return Promise.props({
        offset: 0,
        size: disk.getCapacityAsync()
      });
    } else {
      return partitioninfo.get(disk, partition);
    }
  }).then(function(_arg) {
    var offset, size, type;
    offset = _arg.offset, size = _arg.size, type = _arg.type;
    return createDriverFromFile(disk, offset, size, type);
  });
};
