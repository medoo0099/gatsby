const uuid = require(`uuid/v4`)
const path = require(`path`)
const hasha = require(`hasha`)
const fs = require(`fs-extra`)
const pDefer = require(`p-defer`)
const slash = require(`slash`)
const { createContentDigest } = require(`gatsby-core-utils`)
const reporter = require(`gatsby-cli/lib/reporter`)

let activityForJobs
let activeJobs = 0

/** @type {Map<string, {id: string, deferred: pDefer.DeferredPromise}>} */
const jobsInProcess = new Map()

/**
 * @param {string} path
 * @param {string} rootDir
 * @return {string}
 */
const convertPathsToRelative = (filePath, rootDir) => {
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(rootDir, filePath)
  }

  const relative = path.relative(rootDir, filePath)

  if (relative.includes(`..`)) {
    throw new Error(
      `${filePath} is not inside ${rootDir}. Make sure your files are inside your gatsby project.`
    )
  }

  return slash(relative)
}
/**
 * @param {string} path
 */
const createFileHash = path => hasha.fromFileSync(path, { algorithm: `sha1` })

/**
 * @typedef Job
 * @property {string} name
 * @property {string[]} inputPaths
 * @property {string} outputDir,
 * @property {Record<string, *>} args
 * @property {{name: string, version: string, resolve: string, isLocal: boolean}} plugin
 */

/**
 * @typedef AugmentedJob
 * @property {string} id
 * @property {string} name
 * @property {string} contentDigest
 * @property {{path: string, contentDigest: string}[]} inputPaths
 * @property {string} outputDir,
 * @property {Record<string, *>} args
 * @property {{name: string, version: string, resolve: string, isLocal: boolean}} plugin
 */

/**
 * @deprecated
 * TODO: Remove for Gatsby v3 (compatibility mode)
 */
exports.jobsInProcess = jobsInProcess

/**
 * @template T
 * @param {function({ inputPaths: Job["inputPaths"], outputDir: Job["outputDir"], args: Job["args"]}): T} workerFn
 * @param {Job} job
 * @return Promise<T>
 */
const runLocalWorker = async (workerFn, job) => {
  await fs.ensureDir(job.outputDir)

  return new Promise((resolve, reject) => {
    // execute worker nextTick
    // TODO should we think about threading/queueing here?
    process.nextTick(() => {
      try {
        resolve(
          workerFn({
            inputPaths: job.inputPaths,
            outputDir: job.outputDir,
            args: job.args,
          })
        )
      } catch (err) {
        reject(err)
      }
    })
  })
}

/**
 *
 * @param {AugmentedJob} job
 */
const runJob = ({ plugin, ...job }) => {
  try {
    const worker = require(path.posix.join(plugin.resolve, `gatsby-worker.js`))
    if (!worker[job.name]) {
      throw new Error(`No worker function found for ${job.name}`)
    }

    return runLocalWorker(worker[job.name], job)
  } catch (err) {
    throw new Error(
      `We couldn't find a gatsby-worker.js(${plugin.resolve}/gatsby-worker.js) file for ${plugin.name}@${plugin.version}`
    )
  }
}

const handleJobEnded = () => {
  if (--activeJobs === 0) {
    activityForJobs.end()
    activityForJobs = null
  }
}

/**
 * Create an internal job object
 *
 * @param {Job|AugmentedJob} job
 * @param {{name: string, version: string}} plugin
 * @param {string} rootDir
 * @return {AugmentedJob}
 */
exports.createInternalJob = (job, plugin, rootDir) => {
  // It looks like we already have an augmented job so we shouldn't redo this work
  if (job.id && job.contentDigest) {
    return job
  }

  const { name, inputPaths, outputDir, args } = job

  // TODO see if we can make this async, filehashing might be expensive to wait for
  // currently this needs to be sync as we could miss jobs to have been scheduled and
  // are still processing their hashes
  const inputPathsWithContentDigest = inputPaths.map(path => {
    return {
      path: convertPathsToRelative(path, rootDir),
      contentDigest: createFileHash(path),
    }
  })

  const augmentedJob = {
    id: uuid(),
    name,
    inputPaths: inputPathsWithContentDigest,
    outputDir: convertPathsToRelative(outputDir, rootDir),
    args,
    plugin: {
      name: plugin.name,
      version: plugin.version,
      resolve: plugin.resolve,
      isLocal: !plugin.resolve.includes(`/node_modules/`),
    },
  }

  augmentedJob.contentDigest = createContentDigest({
    name: job.name,
    inputPaths: augmentedJob.inputPaths.map(
      inputPath => inputPath.contentDigest
    ),
    outputDir: augmentedJob.outputDir,
    args: augmentedJob.args,
    plugin: augmentedJob.plugin,
  })

  return augmentedJob
}

/**
 * Creates a job
 *
 * @param {AugmentedJob} job
 * @return {Promise<unknown>}
 */
exports.enqueueJob = async job => {
  // When we already have a job that's executing, return the same promise.
  if (jobsInProcess.has(job.contentDigest)) {
    return jobsInProcess.get(job.contentDigest).deferred.promise
  }

  // Bump active jobs
  activeJobs++
  if (!activityForJobs) {
    activityForJobs = reporter.phantomActivity(`Running jobs`)
    activityForJobs.start()
  }

  const deferred = pDefer()
  jobsInProcess.set(job.contentDigest, {
    id: job.id,
    deferred,
  })

  try {
    await deferred.resolve(runJob(job))
  } catch (err) {
    deferred.reject(err)
  } finally {
    handleJobEnded()
  }

  return deferred.promise
}

/**
 * Wait for all processing jobs to have finished
 *
 * @return {Promise<void>}
 */
exports.waitUntilAllJobsComplete = () => {
  const jobsPromises = []
  jobsInProcess.forEach(({ deferred }) => jobsPromises.push(deferred.promise))

  return Promise.all(jobsPromises).then(() => {})
}

/**
 * @param {Partial<AugmentedJob>  & {inputPaths: AugmentedJob['inputPaths']}} job
 * @return {boolean}
 */
exports.isJobStale = (job, rootDir) => {
  const areInputPathsStale = job.inputPaths.some(inputPath => {
    const fullPath = path.join(rootDir, inputPath.path)
    if (!fs.existsSync(fullPath)) {
      return true
    }

    const fileHash = createFileHash(fullPath)
    return fileHash !== inputPath.contentDigest
  })

  return areInputPathsStale
}
