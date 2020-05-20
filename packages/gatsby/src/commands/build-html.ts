import fs from "fs-extra"
import * as path from "path"
import reporter from "gatsby-cli/lib/reporter"
import { createErrorFromString } from "gatsby-cli/lib/reporter/errors"
import telemetry from "gatsby-telemetry"
import webpack from "webpack"
import {
  name as htmlRenderPackageName,
  version as htmlRenderPackageVersion,
} from "../internal-plugins/html-render/package.json"

import webpackConfig from "../utils/webpack.config"
import { structureWebpackErrors } from "../utils/webpack-error-utils"
import { actions } from "../redux/actions/public"

import { Stage, IProgram } from "./types"

type HTMLBuildStage = Stage.BuildHTML | Stage.DevelopHTML

type IActivity = any // TODO

const { createJobV2 } = actions

const runWebpack = (compilerConfig): Bluebird<webpack.Stats> =>
  new Promise((resolve, reject) => {
    webpack(compilerConfig).run((err, stats) => {
      if (err) {
        reject(err)
      } else {
        resolve(stats)
      }
    })
  })

const doBuildRenderer = async (
  { directory }: IProgram,
  webpackConfig: webpack.Configuration
): Promise<string> => {
  const stats = await runWebpack(webpackConfig)
  if (stats.hasErrors()) {
    reporter.panic(
      structureWebpackErrors(`build-html`, stats.compilation.errors)
    )
  }

  // render-page.js is hard coded in webpack.config
  return `${directory}/public/render-page.js`
}

const buildRenderer = async (
  program: IProgram,
  stage: Stage,
  parentSpan: IActivity
): Promise<string> => {
  const { directory } = program
  const config = await webpackConfig(program, directory, stage, null, {
    parentSpan,
  })

  return doBuildRenderer(program, config)
}

const deleteRenderer = async (rendererPath: string): Promise<void> => {
  try {
    await fs.remove(rendererPath)
    await fs.remove(`${rendererPath}.map`)
  } catch (e) {
    // This function will fail on Windows with no further consequences.
  }
}

const renderHTMLQueue = async (
  activity: IActivity,
  htmlComponentRendererPath: string,
  pages: string[],
  store: any
): Promise<void> => {
  // We need to only pass env vars that are set programmatically in gatsby-cli
  // to child process. Other vars will be picked up from environment.
  const envVars = [
    [`NODE_ENV`, process.env.NODE_ENV],
    [`gatsby_executing_command`, process.env.gatsby_executing_command],
    [`gatsby_log_level`, process.env.gatsby_log_level],
    [`gatsby_canary_version`, `distributed-builds`],
  ]

  const pagePromises = pages.map(page => {
    const pageDataPath = page === `/` ? `index` : page

    return createJobV2(
      {
        name: `RENDER_HTML`,
        // TODO ADD ALL PAGE-DATA JSON files so support lifecycle
        inputPaths: [
          htmlComponentRendererPath,
          path.resolve(
            path.join(`public/page-data/`, pageDataPath, `page-data.json`)
          ),
          path.resolve(`public/page-data/app-data.json`),
        ],
        outputDir: path.join(process.cwd(), `public`),
        args: {
          page,
          pageDataPath: path.posix.join(
            `page-data/`,
            pageDataPath,
            `/page-data.json`
          ),
          envVars,
        },
      },
      {
        name: htmlRenderPackageName,
        version: htmlRenderPackageVersion,
        resolve: path.dirname(
          require.resolve(`../internal-plugins/html-render`)
        ),
      }
    )(store.dispatch, store.getState).then(res => {
      activity.tick()

      return res
    })
  })

  await Promise.all(pagePromises)
}

const doBuildPages = async (
  rendererPath: string,
  pagePaths: string[],
  activity: IActivity,
  store: any
): Promise<void> => {
  telemetry.addSiteMeasurement(`BUILD_END`, {
    pagesCount: pagePaths.length,
  })

  try {
    await renderHTMLQueue(activity, rendererPath, pagePaths, store)
  } catch (error) {
    const prettyError = await createErrorFromString(
      error.stack,
      `${rendererPath}.map`
    )
    prettyError.context = error.context
    throw prettyError
  }
}

export const buildHTML = async ({
  program,
  stage,
  pagePaths,
  activity,
  store,
}: {
  program: IProgram
  stage: HTMLBuildStage
  pagePaths: string[]
  activity: IActivity
  store: any
}): Promise<void> => {
  const rendererPath = await buildRenderer(program, stage, activity.span)
  await doBuildPages(rendererPath, pagePaths, activity, store)
  await deleteRenderer(rendererPath)
}
