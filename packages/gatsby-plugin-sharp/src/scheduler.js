const _ = require(`lodash`)
const { existsSync } = require(`fs`)
const uuidv4 = require(`uuid/v4`)
const pDefer = require(`p-defer`)
const worker = require(`./worker`)
const { createProgress } = require(`./utils`)

const toProcess = new Map()
let imagesToProcess = 0
let imagesFinished = 0

let bar

// node 8 doesn't support promise.finally, we extract this function to re-use it inside then & catch
const cleanupJob = (job, boundActionCreators) => {
  if (bar) {
    bar.tick(job.args.operations.length)
  }

  imagesFinished++

  if (imagesFinished === imagesToProcess) {
    if (bar) {
      bar.done()
      bar = null
    }
    imagesToProcess = 0
    imagesFinished = 0
  }

  boundActionCreators.endJob({ id: job.id }, { name: `gatsby-plugin-sharp` })
}

const executeJobs = _.throttle(
  (pluginOptions, boundActionCreators) => {
    toProcess.forEach(job => {
      toProcess.delete(job.args.inputPath)

      try {
        worker({
          ...job.args,
          pluginOptions,
        })
          .then(() => {
            job.deferred.resolve()
            cleanupJob(job, boundActionCreators)
          })
          .catch(err => {
            job.deferred.reject(err)
            cleanupJob(job, boundActionCreators)
          })
      } catch (err) {
        job.deferred.reject(err)
      }
    })
  },
  1000,
  { leading: false }
)

const scheduleJob = async (
  job,
  boundActionCreators,
  reporter,
  reportStatus = true,
  pluginOptions
) => {
  const isQueued = toProcess.has(job.inputPath)
  let scheduledPromise

  if (reportStatus && !bar) {
    bar = createProgress(`Generating image thumbnails`, reporter)
    bar.start()
  }

  // Check if the output file already exists so we don't redo work.
  if (existsSync(job.outputPath)) {
    return Promise.resolve()
  }

  // if an input image is already queued we add it to a transforms queue
  // doing different manipulations in parallel makes sharp faster.
  if (isQueued) {
    const registeredJob = toProcess.get(job.inputPath)
    // add the transform to the transforms list
    const operations = registeredJob.args.operations.concat({
      outputPath: job.outputPath,
      transforms: job.args,
    })
    scheduledPromise = registeredJob.deferred.promise

    toProcess.set(job.inputPath, {
      ...registeredJob,
      args: {
        ...registeredJob.args,
        operations,
      },
    })

    // update the job
    boundActionCreators.setJob(
      {
        id: registeredJob.id,
        imagesCount: operations.length,
      },
      { name: `gatsby-plugin-sharp` }
    )
  } else {
    const jobId = uuidv4()
    const deferred = pDefer()
    scheduledPromise = deferred.promise

    // Save a job in our queue
    toProcess.set(job.inputPath, {
      id: jobId,
      args: {
        inputPath: job.inputPath,
        contentDigest: job.contentDigest,
        operations: [
          {
            outputPath: job.outputPath,
            transforms: job.args,
          },
        ],
      },
      deferred,
    })

    // create the job so gatsby waits for completion
    boundActionCreators.createJob(
      {
        id: jobId,
        description: `processing image ${job.inputPath}`,
        imagesCount: 1,
      },
      { name: `gatsby-plugin-sharp` }
    )
  }
  imagesToProcess++
  if (bar) {
    bar.total = imagesToProcess
  }

  executeJobs(pluginOptions, boundActionCreators, reportStatus)

  return scheduledPromise
}

export { scheduleJob }
