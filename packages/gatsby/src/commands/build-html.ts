import Bluebird from "bluebird"
import fs from "fs-extra"
import * as path from "path"
import reporter from "gatsby-cli/lib/reporter"
import { createErrorFromString } from "gatsby-cli/lib/reporter/errors"
import telemetry from "gatsby-telemetry"
import { chunk } from "lodash"
import webpack from "webpack"
import { createInternalJob, enqueueJob } from "../utils/jobs-manager"
import {
  name as htmlRenderPackageName,
  version as htmlRenderPackageVersion,
} from "../internal-plugins/html-render/package.json"

import webpackConfig from "../utils/webpack.config"
import { structureWebpackErrors } from "../utils/webpack-error-utils"
import { actions } from "../redux/actions/public"

import { IProgram, Stage } from "./types"

type IActivity = any // TODO
type IWorkerPool = any // TODO

const { createJobV2 } = actions

const runWebpack = (compilerConfig): Bluebird<webpack.Stats> =>
  new Bluebird((resolve, reject) => {
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
  workerPool: IWorkerPool,
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
  ]

  const pagePromises = pages.map(
    page =>
      createJobV2(
        {
          name: `RENDER_HTML`,
          inputPaths: [htmlComponentRendererPath],
          outputDir: path.join(process.cwd(), `public`),
          args: {
            page,
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
    // store.dispatch()
    // const job = createInternalJob(
    //   {
    //     name: `RENDER_HTML`,
    //     inputPaths: [htmlComponentRendererPath],
    //     outputDir: path.join(process.cwd(), `public`),
    //     args: {
    //       page,
    //       envVars,
    //     },
    //   },
    //   {
    //     name: htmlRenderPackageName,
    //     version: htmlRenderPackageVersion,
    //     resolve: path.dirname(
    //       require.resolve(`../internal-plugins/html-render`)
    //     ),
    //   }
    // )

    // return enqueueJob(job).then(res => {
    //   activity.tick()

    //   return res
    // })
  )

  await Promise.all(pagePromises)

  // const start = process.hrtime()
  // const segments = chunk(pages, 50)

  // await Bluebird.map(segments, async pageSegment => {
  //   await workerPool.renderHTML({
  //     envVars,
  //     htmlComponentRendererPath,
  //     paths: pageSegment,
  //   })

  //   if (activity && activity.tick) {
  //     activity.tick(pageSegment.length)
  //   }
  // })
}

const doBuildPages = async (
  rendererPath: string,
  pagePaths: string[],
  activity: IActivity,
  workerPool: IWorkerPool,
  store: any
): Promise<void> => {
  telemetry.addSiteMeasurement(`BUILD_END`, {
    pagesCount: pagePaths.length,
  })

  try {
    await renderHTMLQueue(workerPool, activity, rendererPath, pagePaths, store)
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
  workerPool,
  store,
}: {
  program: IProgram
  stage: Stage
  pagePaths: string[]
  activity: IActivity
  workerPool: IWorkerPool
  store: any
}): Promise<void> => {
  const rendererPath = await buildRenderer(program, stage, activity.span)
  await doBuildPages(rendererPath, pagePaths, activity, workerPool, store)
  await deleteRenderer(rendererPath)
}
