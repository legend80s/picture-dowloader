const http = require('http');
const https = require('https');
const URL = require('url');
const fs = require('fs');
const request = require('request');
const cheerio = require('cheerio');
const yargs = require('yargs');

/** in second */
const DEFAULT_TIMEOUT = 3;
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_DIST = './images';

const YELLOW = '\x1b[1;33m';
const GRAY = '\x1b[0;37m';
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';

/** End Of Style, removes all attributes (formatting and colors) */
const EOS = '\x1b[0m';
const BOLD = '\x1b[1m';

function error(...args) {
  console.log(RED);
  console.error(...args);
  console.log(EOS);
}

const argv = yargs
  .option('url', {
    alias: 'U',
    type: 'string',
    description: 'Target url to download image from.',
    required: true,
  })
  .option('concurrency', {
    alias: 'C',
    type: 'number',
    default: DEFAULT_CONCURRENCY,
    description:
      'Download concurrency. The number of pictures to be downloaded in the same time.'
  })
  .option('timeout', {
    alias: 'T',
    type: 'number',
    default: DEFAULT_TIMEOUT,
    description: 'Timeout in second to download a picture.'
  })
  .option('out', {
    alias: 'O',
    type: 'string',
    default: './images',
    description: 'Destination folder for the pictures to be download into.'
  })
  .option('verbose', {
    alias: 'V',
    type: 'boolean',
    default: false,
    description: 'Show all the downloading image srcs.'
  })
  .help('help', 'example: npm start -- --url https://www.baidu.com -O ~/Downloads/baidu -C 2')
  .argv;

async function main(args) {
  // console.log('args:', args);
  // const argv = parseArgs(args); console.log('argv:', argv);
  // process.exit();
  const { url, concurrency = DEFAULT_CONCURRENCY, verbose, out, timeout } = argv;
  // console.log('argv:', argv);

  const dist = out || DEFAULT_DIST;
  const MAIN_LABEL = `${GREEN}Images from ${(bold(url))} ${GREEN}have been downloaded into ${bold(dist)} ${GREEN}with concurrency ${bold(concurrency)} ${GREEN}total cost${EOS}`;
  console.time(MAIN_LABEL);

  console.time(`${GREEN}fetch ${url}`);
  const html = await fetchHtml(url);
  console.timeEnd(`${GREEN}fetch ${url}`);
  console.log(EOS);

  const srcs = extractImgSrcs(html);

  // console.log('srcs:', srcs);


  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist);
  }

  const label = `\n${GRAY}Try to download ${srcs.length} pictures`;

  console.time(label);

  let total = 0;

  try {
    total = await downloadAllImages(url, srcs, concurrency, verbose, dist, timeout * 1000);
  } catch (error) {
    console.log(RED);
    console.error(error);
    console.log(EOS);
  } finally {
    console.timeEnd(label);
    console.log(EOS);

    console.timeEnd(MAIN_LABEL);

    console.log(`\n${GREEN}${total} pictures downloaded.`);
    console.log();

    process.exit(0);
  }
}

// console.log('process.argv:', process.argv);

main(process.argv.slice(2));

/**
 * Paint it bold in console
 * @param {string} msg
 */
function bold(msg) {
  return `${BOLD}${msg}${EOS}`;
}

/**
 * @param {string[]} srcs
 * @param {number} concurrency
 * @param {boolean} verbose
 * @param {string} dist
 * @param {number} timeout in ms
 */
async function downloadAllImages(url, srcs, concurrency = DEFAULT_CONCURRENCY, verbose = false, dist = DEFAULT_DIST, timeout = DEFAULT_TIMEOUT) {
  const chunks = chunk(srcs, concurrency);

  // Promise.all(chunk).then(() => {
  //   return Promise.all(chunk);
  // }).then(() => {
  //   return Promise.all(chunk);
  // }).then(() => {
  //   return Promise.all(chunk);
  // }).then(() => {
  //   return Promise.all(chunk);
  // })

  // [ [1,2], [3] ] => [
  //   () => Promise.all([downloadImg(1), downloadImg(2)]),
  //   () => Promise.all([downloadImg(3)]
  // ]

  let errorCount = 0;

  const downloadChunks = chunks.map(srcs => {
    return () => Promise.all(srcs.map(src => {
      const fullSrc = assembleFullSrc(url, src);
      const filePath = `${dist}/${normalizeSrc(fullSrc)}`;

      // 防止一个图片下载失败阻断其他图片下载
      return downloadImg(fullSrc, filePath, timeout, verbose).catch(err => {
        errorCount++;

        error(err);
      });
    }));
  });

  await downloadChunks.reduce((acc, chunk) => {
    return acc.then(() => chunk());
  }, Promise.resolve());

  return srcs.length - errorCount;
}

/**
 * Normalize src to a valid folder name.
 * @param {string} src
 * @example
 * normalizeSrc('https://liangcang-material.alicdn.com/feupload/fcpkhan0yhdov7ioelg1580649479315.jpg?x-oss-process=image/resize,w_290/interlace,1/quality,Q_80/sharpen,100')
 * // => https___liangcang-material.alicdn.comfeupload_fcpkhan0yhdov7ioelg1580649479315.jpg
 */
function normalizeSrc(src) {
  return src
    .replace(':', '_')
    .replace(/\//g, '_')
    .replace(/\?.+$/, '')
    ;
}

/**
 *
 * @param {any[]} array
 * @param {number} size
 */
function chunk(array, size = 1) {
  if (size <= 0) {
    return [];
  }

  const chunks = [];
  const copy = [...array];

  while (copy.length) {
    const group = copy.splice(0, size);

    chunks.push(group)
  }

  return chunks
}


/**
 * @param {string} url
 * @param {string} src
 */
function assembleFullSrc(url, src) {
  const { protocol, host } = URL.parse(url);
  const hasProtocol = URL.parse(src).protocol !== null;

  if (hasProtocol) {
    return src;
  }

  if (src[0] === '/' && src[1] !== '/') {
    return `${protocol}//${host}/${src}`;
  }

  return `${protocol}${src}`;
}

/**
 * @param {string} src
 * @param {string} filePath
 * @param {number} timeout
 * @param {boolean} verbose
 */
function downloadImg(src, filePath, timeout = 2000, verbose = false) {
  // console.log('verbose:', verbose);
  verbose && console.log('downloading [', src, '] to [', filePath, ']');

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`download ${src} timeout for ${timeout / 1000}s`))
    }, timeout);

    request
      .get(src)
      .on('error', function(err) {
        reject(`download ${src} error: ${err.message}`);
      })
      .pipe(fs.createWriteStream(filePath))
      .on('close', () => {
        verbose && console.log('downloaded [', src, ']');
        verbose && console.log();
        resolve()
        // console.log(src, '2closed');
      })
      ;
  })
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function extractImgSrcs(html) {
  const $ = cheerio.load(html);

  return Array.from($('img').map((_, img) => {
    // console.log('img.attribs.src:', img.attribs.src);
    return img.attribs.src;
  }));
}

/**
 * @param {string[]} args
 * @returns {Record<string, string>}
 *
 * @example
 * parseArgs([ '--url=https://baidu.com/' ])
 * // => { url: 'https://baidu.com/' }
 */
// function parseArgs(args) {
//   // args = ['--url=https://www.baidu.com', '--concurrency=2']
//   const TYPES = {
//     NUMBER: 'number',
//     BOOLEAN: 'boolean',
//   };

//   const MAP = {
//     C: { type: TYPES.NUMBER, alias: 'concurrency' },
//     V: { type: TYPES.BOOLEAN, alias: 'verbose' },
//     h: { type: TYPES.BOOLEAN, alias: 'help' },

//     verbose: { type: TYPES.BOOLEAN },
//     help: { type: TYPES.BOOLEAN },
//   };

//   return args.reduce((acc, cur) => {
//     const parts = cur.split('=');

//     const key = parts[0].replace(/^-+/, ''); // url
//     const value = formatValue(parts[1], MAP[key]); // https://baidu.com/
//     // console.log('value:', value, typeof value);

//     const mappedKey = (MAP[key] && MAP[key].alias) || key;

//     acc[mappedKey] = value;

//     return acc;
//   }, {})

//   /**
//    *
//    * @param {string} value
//    * @param {{ type: string; alias: string }} rules
//    */
//   function formatValue(value, rules = {}) {
//     const { type = '' } = rules;
//     const uppercasedType = type.toUpperCase();

//     // console.log('value:', value, 'rules', rules, 'TYPES', TYPES);

//     if (!TYPES[uppercasedType]) {
//       return value;
//     }

//     // console.log('1type:', type);

//     switch (type) {
//       case TYPES.NUMBER:
//         return Number(value) || 0;
//         break;

//     case TYPES.BOOLEAN:
//       return true;
//       break;

//     default:
//       throw new TypeError(
//         'type invalid, expecting: [ ' +
//         Object.values(TYPES).map(t => t.toLowerCase()).join(', ') +
//         ' ], but ' + type + ' seen',
//       );
//       break;
//     }
//   }
// }

/**
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
function fetchHtml(url) {
  const httpModule = url.startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    httpModule.get(url, (res) => {
      const { statusCode } = res;
      const contentType = res.headers['content-type'];

      let error;
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      } else if (!/^text\/html/.test(contentType)) {
        error = new Error('Invalid content-type.\n' +
                          `Expected text/html but received ${contentType}`);
      }

      if (error) {
        console.error(error.message);
        // Consume response data to free up memory
        res.resume();
        return;
      }

      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });

      res.on('end', () => {
        // console.log('rawData:', rawData);

        resolve(rawData);
      });
    }).on('error', (e) => {
      console.error(`fetchHtml Got error: ${e.message}`);

      reject(e);
    });
  });
}
