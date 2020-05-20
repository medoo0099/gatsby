const fs = require(`fs-extra`)
const { getPageHtmlFilePath } = require(`../../utils/page-html`)

exports.RENDER_HTML = ({ inputPaths, outputDir, args }) => {
  const { envVars, page, pageDataPath } = args
  const htmlComponentRenderer = require(inputPaths[0].path)
  const appDataPath = `page-data/app-data.json`

  // This is being executed in child process, so we need to set some vars
  // for modules that aren't bundled by webpack.
  envVars.forEach(([key, value]) => (process.env[key] = value))

  return new Promise((resolve, reject) => {
    try {
      htmlComponentRenderer.default(
        {
          page,
          pageDataPath,
          appDataPath,
        },
        (_throwAway, htmlString) => {
          resolve(
            fs.outputFile(getPageHtmlFilePath(outputDir, page), htmlString)
          )
        }
      )
    } catch (e) {
      e.context = {
        path: page,
      }

      reject(e)
    }
  })
}
