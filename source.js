const fs = require('fs')
const path = require('path')
const titleCase = require('ap-style-title-case')
const {
  assert,
  copyFile,
  decodeHTMLEntities,
  distributionPath,
  downloadFile,
  executeCommand,
  extractPath,
  fetchURL,
  isURL,
  makeDirectories,
} = require('.')
const { downsampleDocument } = require('./downsample-document')

const averageColor = image =>
  executeCommand(['convert', image, '-resize', '1x1', 'txt:-'])
    .match(/#\w+/)[0]
    .toLowerCase()

const buildBooks = (
  books,
  generateBook = book => book,
  sortByCreated = false,
  exclusions = [],
) => {
  const added = new Date().toISOString().replace(/\..+(Z)$/, '$1')
  const existingBooks = sourceBooks()
  const file = distributionSourcePath('books.json')
  fs.writeFileSync(
    makeDirectories(file),
    JSON.stringify(
      [
        ...books
          .map(book => ({
            ...book,
            slug: assert(
              book.slug || path.basename(extractPath(book.document), '.pdf'),
              `No slug key`,
            ),
          }))
          .filter(
            book =>
              !exclusions.includes(book.slug) &&
              !existingBooks.find(
                existingBook => existingBook.slug === book.slug,
              ),
          )
          .map(book => {
            const result = generateBook(book)
            return result
              ? {
                  ...book,
                  ...result,
                }
              : null
          })
          .filter(Boolean)
          .map(book => {
            const document = distributionSourcePath(`${book.slug}.pdf`)
            isURL(assert(book.document, 'No document key'))
              ? downloadFile(book.document, document)
              : book.document !== document
              ? copyFile(book.document, document)
              : undefined
            book.processDocument &&
              book.processDocument(
                document,
                suppressExceptions(() => parsePDFInfo(document, 'Pages')),
                book,
              )
            fs.statSync(document).size > 3500000 &&
              downsampleDocument(document, 75)
            const cover = distributionSourcePath(`${book.slug}.jpg`)
            book.cover
              ? downloadCover(book.cover, cover, book.coverOptions)
              : extractCover(document, cover, book.coverOptions)
            book.processCover && book.processCover(cover)
            return {
              added,
              background: averageColor(cover),
              created: parsePDFInfo(document, 'CreationDate'),
              size: fs.statSync(document).size,
              slug: book.slug,
              source: sourceName(),
              title: titleCase(
                assert(
                  book.title
                    ? decodeHTMLEntities(book.title)
                    : book.extractTitle
                    ? book.extractTitle(document)
                    : parsePDFInfo(document, 'Title'),
                  `No title for ${book.slug}`,
                ),
              ),
            }
          })
          .reduce(
            (books, book) =>
              assert(
                !books.find(existingBook => existingBook.slug === book.slug),
                `Duplicate book ${book.slug}`,
              ) && [...books, book],
            [],
          )
          .sort(
            sortByCreated
              ? (a, b) => -a.created.localeCompare(b.created)
              : () => 0,
          ),
        ...existingBooks,
      ],
      null,
      2,
    ) + '\n',
  )
  return file
}

const convertCoverOptions = ['-quality', '80%', '-resize', '768x768>']

const convertCropOptions = [
  '-set',
  'option:distort:viewport',
  '%[fx: w > h ? h : w]x%[fx: w > h ? h : w]+%[fx: w > h ? (w - h) / 2 : 0]+%[fx: w > h ? 0 : (h - w) / 2]',
  '-filter',
  'point',
  '-distort',
  'SRT',
  0,
  '+repage',
]

const distributionSourcePath = filename =>
  distributionPath(sourceName(), filename)

const downloadCover = (url, output, options = []) => {
  executeCommand(['convert', ...options, ...convertCoverOptions, '-', output], {
    input: fetchURL(url, undefined, true),
  })
  return output
}

const extractCover = (document, output, options = []) => {
  executeCommand(['convert', ...options, ...convertCoverOptions, '-', output], {
    input: executeCommand(
      [
        'gs',
        '-o',
        '-',
        ...ghostscriptOptions,
        '-dFirstPage=1',
        '-dGraphicsAlphaBits=4',
        '-dLastPage=1',
        '-dTextAlphaBits=4',
        '-dUseCropBox',
        '-sDEVICE=png16m',
        document,
      ],
      { encoding: 'buffer' },
    ),
  })
  return output
}

const ghostscriptOptions = [
  '-q',
  '-dBATCH',
  '-dNOPAUSE',
  '-dSAFER',
  '-sDEVICE=pdfwrite',
]

const parsePDFInfo = (pdf, key) => {
  const value = (
    executeCommand(['pdfinfo', pdf])
      .split('\n')
      .find(line => line.startsWith(`${key}:`)) || ''
  ).replace(/^.+?:\s+/, '')
  return key === 'Pages'
    ? Number(value)
    : key.endsWith('Date')
    ? value
      ? executeCommand(['date', '-Iseconds', '-d', value], {
          env: { TZ: 'UTC' },
        })
          .trimEnd()
          .replace(/\+.+$/, 'Z')
      : null
    : value
}

const sourceBooks = () => {
  const file = distributionSourcePath('books.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
}

const sourceName = () => path.basename(require.main.filename)

const suppressExceptions = func => {
  try {
    func()
  } catch {}
}

module.exports = {
  buildBooks,
  convertCropOptions,
  distributionSourcePath,
  ghostscriptOptions,
  parsePDFInfo,
  sourceBooks,
  sourceName,
}
