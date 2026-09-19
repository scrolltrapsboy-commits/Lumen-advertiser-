/**
 * Server-side "actual media dimensions" reader - the backend half of
 * PART 15/16 of the small-display-preview spec: never trust filename,
 * extension, MIME type, or a client-supplied width/height, always read
 * the file's own real dimensions, and enforce that on the server (not
 * just in the browser) with no bypass for any role including admin.
 *
 * - Images (png/jpeg/webp): the `image-size` package reads real pixel
 *   dimensions straight from the file's own header bytes.
 * - video/mp4 and video/quicktime (.mov): both are ISO-BMFF ("box")
 *   containers with an identical box structure for this purpose, so one
 *   parser covers both - walks moov -> trak -> tkhd and reads the
 *   track's width/height (fixed-point 16.16, i.e. divide by 65536).
 *   Deliberately NOT using ffprobe/ffmpeg: that would add a system
 *   binary dependency this project doesn't otherwise have and that
 *   isn't guaranteed to exist in every deployment environment - a pure
 *   parse of the container's own header is dependency-free and just as
 *   authoritative for width/height.
 * - video/webm: a Matroska/EBML container - walks to the first Video
 *   track entry and reads its PixelWidth (0xB0) / PixelHeight (0xBA)
 *   elements.
 *
 * Every parser here only reads a small header region of the file (a few
 * KB for images, up to a bounded scan depth for video containers), never
 * the whole media payload.
 */

const fs = require('fs');
const { imageSize } = require('image-size');

function getImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const { width, height } = imageSize(buffer);
  return { width, height };
}

// ---- ISO-BMFF (mp4 / mov) ----
// A box is: [4 bytes big-endian size][4 bytes fourcc][payload...]
// (the 64-bit "largesize" extension is handled but is exceedingly rare
// for the small ad-sized files this app accepts).
function readBoxHeader(buf, offset) {
  if (offset + 8 > buf.length) return null;
  let size = buf.readUInt32BE(offset);
  const type = buf.toString('ascii', offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    // 64-bit largesize follows immediately
    if (offset + 16 > buf.length) return null;
    const high = buf.readUInt32BE(offset + 8);
    const low = buf.readUInt32BE(offset + 12);
    size = high * 2 ** 32 + low;
    headerSize = 16;
  } else if (size === 0) {
    // "extends to end of file" - only meaningful for the outermost box;
    // safe enough here to just clamp to what's left in the buffer.
    size = buf.length - offset;
  }
  return { type, size, headerSize, bodyStart: offset + headerSize, bodyEnd: offset + size };
}

/** Finds the first direct child box of `type` within buf[start,end). */
function findChildBox(buf, start, end, type) {
  let offset = start;
  while (offset < end) {
    const box = readBoxHeader(buf, offset);
    if (!box || box.size <= 0 || box.bodyEnd > end) return null;
    if (box.type === type) return box;
    offset = box.bodyEnd;
  }
  return null;
}

function getMp4Dimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const moov = findChildBox(buf, 0, buf.length, 'moov');
  if (!moov) throw new Error('No moov box found (not a valid MP4/MOV file, or an unsupported streaming layout).');

  // A file can have multiple tracks (e.g. audio + video) - walk every
  // trak and use the first one whose tkhd reports a non-zero
  // width/height (the video track; an audio-only trak's tkhd reports
  // 0x0).
  let offset = moov.bodyStart;
  while (offset < moov.bodyEnd) {
    const trak = readBoxHeader(buf, offset);
    if (!trak || trak.size <= 0) break;
    if (trak.type === 'trak') {
      const tkhd = findChildBox(buf, trak.bodyStart, trak.bodyEnd, 'tkhd');
      if (tkhd) {
        const version = buf.readUInt8(tkhd.bodyStart);
        // FullBox header (version+flags) = 4 bytes, then:
        // v0: creation/modification/track_ID/reserved/duration = 4x5=20B,
        //     reserved[2]=8B, layer/alt_group/volume/reserved=8B,
        //     matrix=36B -> width at byte 4+20+8+8+36 = 76.
        // v1: same fields but creation/modification/duration are 64-bit
        //     (+12B total) -> width at byte 88.
        const widthOffset = tkhd.bodyStart + (version === 1 ? 88 : 76);
        if (widthOffset + 8 <= tkhd.bodyEnd) {
          const width = buf.readUInt32BE(widthOffset) / 65536;
          const height = buf.readUInt32BE(widthOffset + 4) / 65536;
          if (width > 0 && height > 0) {
            return { width: Math.round(width), height: Math.round(height) };
          }
        }
      }
    }
    offset = trak.bodyEnd;
  }
  throw new Error('Could not find a video track with valid dimensions in this MP4/MOV file.');
}

// ---- EBML (webm) ----
// Element IDs are variable-length ("VINT"). We only need to recognise a
// handful of fixed IDs, but still have to walk every element correctly
// (reading sizes as VINTs) to skip past ones we don't care about.
function readVint(buf, offset, { keepMarkerBit = false } = {}) {
  const first = buf[offset];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buf.length) return null;
  let value = keepMarkerBit ? first : (first & (mask - 1));
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[offset + i];
  }
  return { value, length };
}

const EBML_IDS = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba
};

function readElementId(buf, offset) {
  const vint = readVint(buf, offset, { keepMarkerBit: true });
  if (!vint) return null;
  return { id: vint.value, length: vint.length };
}

/** Walks direct children of an EBML container in buf[start,end),
 * calling onElement(id, dataStart, dataEnd) for each. Returning `false`
 * from onElement stops the walk early. */
function walkEbml(buf, start, end, onElement) {
  let offset = start;
  while (offset < end) {
    const idInfo = readElementId(buf, offset);
    if (!idInfo) return;
    const sizeInfo = readVint(buf, offset + idInfo.length);
    if (!sizeInfo) return;
    const dataStart = offset + idInfo.length + sizeInfo.length;
    const dataEnd = Math.min(end, dataStart + sizeInfo.value);
    if (onElement(idInfo.id, dataStart, dataEnd) === false) return;
    offset = dataEnd;
  }
}

function readUintElement(buf, start, end) {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + buf[i];
  return value;
}

function getWebmDimensions(filePath) {
  // Track headers are always near the start of a well-formed webm file
  // (before any cluster/frame data), so a bounded read of the first few
  // MB is enough - no need to load a potentially very large video file
  // into memory in full.
  const fd = fs.openSync(filePath, 'r');
  let buf;
  try {
    const stat = fs.fstatSync(fd);
    const readLength = Math.min(stat.size, 8 * 1024 * 1024);
    buf = Buffer.alloc(readLength);
    fs.readSync(fd, buf, 0, readLength, 0);
  } finally {
    fs.closeSync(fd);
  }

  let result = null;
  walkEbml(buf, 0, buf.length, (id, start, end) => {
    if (id !== EBML_IDS.Segment) return true; // keep scanning top level
    walkEbml(buf, start, end, (id2, start2, end2) => {
      if (id2 !== EBML_IDS.Tracks) return true;
      walkEbml(buf, start2, end2, (id3, start3, end3) => {
        if (id3 !== EBML_IDS.TrackEntry) return true;
        let isVideo = false;
        let width = null;
        let height = null;
        walkEbml(buf, start3, end3, (id4, start4, end4) => {
          if (id4 === EBML_IDS.TrackType && readUintElement(buf, start4, end4) === 1) {
            isVideo = true;
          } else if (id4 === EBML_IDS.Video) {
            walkEbml(buf, start4, end4, (id5, start5, end5) => {
              if (id5 === EBML_IDS.PixelWidth) width = readUintElement(buf, start5, end5);
              if (id5 === EBML_IDS.PixelHeight) height = readUintElement(buf, start5, end5);
              return true;
            });
          }
          return true;
        });
        if (isVideo && width && height) {
          result = { width, height };
          return false; // found it - stop walking TrackEntry siblings
        }
        return true;
      });
      return result === null;
    });
    return result === null;
  });

  if (!result) {
    throw new Error('Could not find a video track with valid dimensions in this WEBM file (or the header was further into the file than the bounded scan window).');
  }
  return result;
}

/**
 * @param {string} filePath
 * @param {string} mimetype
 * @returns {{ width: number, height: number }}
 * @throws if the file can't be parsed - callers should treat this the
 *   same as a failed validation, not a 500 (a corrupt/unreadable file is
 *   itself a reason to reject the upload).
 */
function getMediaDimensions(filePath, mimetype) {
  if (mimetype === 'image/png' || mimetype === 'image/jpeg' || mimetype === 'image/webp') {
    return getImageDimensions(filePath);
  }
  if (mimetype === 'video/mp4' || mimetype === 'video/quicktime') {
    return getMp4Dimensions(filePath);
  }
  if (mimetype === 'video/webm') {
    return getWebmDimensions(filePath);
  }
  throw new Error(`Unsupported mimetype for dimension probing: ${mimetype}`);
}

module.exports = { getMediaDimensions, getImageDimensions, getMp4Dimensions, getWebmDimensions };
