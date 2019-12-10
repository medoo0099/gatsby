const path = require(`path`)
const _ = require(`lodash`)
const ROOT_DIR = __dirname

// I need a mock to spy on
jest.mock(`p-defer`, () =>
  jest.fn().mockImplementation(jest.requireActual(`p-defer`))
)

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {
    phantomActivity: jest.fn(),
  }
})

jest.mock(
  `/node_modules/gatsby-plugin-test/gatsby-worker.js`,
  () => {
    return {
      TEST_JOB: jest.fn(),
    }
  },
  { virtual: true }
)

jest.mock(`../../redux`, () => {
  return {
    store: {
      getState: jest.fn(),
    },
  }
})

const worker = require(`/node_modules/gatsby-plugin-test/gatsby-worker.js`)
const reporter = require(`gatsby-cli/lib/reporter`)
const { store } = require(`../../redux`)
const getJobsManager = () => {
  let jobManager
  jest.isolateModules(() => {
    jobManager = require(`../jobs-manager`)
  })

  return jobManager
}

const pDefer = require(`p-defer`)
const plugin = {
  name: `gatsby-plugin-test`,
  version: `1.0.0`,
  resolve: `/node_modules/gatsby-plugin-test`,
}

const createMockJob = (overrides = {}) => {
  return {
    name: `TEST_JOB`,
    inputPaths: [
      path.join(ROOT_DIR, `fixtures/input1.jpg`),
      path.join(ROOT_DIR, `fixtures/input2.jpg`),
    ],
    outputDir: path.join(ROOT_DIR, `public/outputDir`),
    args: {
      param1: `param1`,
      param2: `param2`,
    },
    ...overrides,
  }
}

const createInternalMockJob = (overrides = {}) => {
  const { createInternalJob } = getJobsManager()

  return createInternalJob(createMockJob(overrides), plugin, ROOT_DIR)
}

describe(`Jobs manager`, () => {
  const endActivity = jest.fn()
  beforeEach(() => {
    worker.TEST_JOB.mockReset()
    endActivity.mockClear()
    pDefer.mockClear()
    store.getState.mockClear()
    store.getState.mockImplementation(() => {
      return {
        program: {
          directory: ROOT_DIR,
        },
      }
    })
    reporter.phantomActivity.mockImplementation(() => {
      return {
        start: jest.fn(),
        end: endActivity,
      }
    })
  })

  describe(`createInternalJob`, () => {
    it(`should return the correct format`, async () => {
      const { createInternalJob } = getJobsManager()
      const mockedJob = createMockJob()
      const job = createInternalJob(mockedJob, plugin, ROOT_DIR)

      expect(job).toStrictEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: mockedJob.name,
          contentDigest: expect.any(String),
          inputPaths: [
            {
              path: `fixtures/input1.jpg`,
              contentDigest: expect.any(String),
            },
            {
              path: `fixtures/input2.jpg`,
              contentDigest: expect.any(String),
            },
          ],
          outputDir: `public/outputDir`,
          args: mockedJob.args,
          plugin: {
            name: `gatsby-plugin-test`,
            version: `1.0.0`,
            resolve: `/node_modules/gatsby-plugin-test`,
            isLocal: false,
          },
        })
      )
    })

    it(`should fail when paths are outside of gatsby`, async () => {
      const { createInternalJob } = getJobsManager()
      const jobArgs = createMockJob({
        inputPaths: [`/anotherdir/files/image.jpg`],
      })

      expect.assertions(1)
      try {
        createInternalJob(jobArgs, plugin, ROOT_DIR)
      } catch (err) {
        expect(err).toMatchInlineSnapshot(
          `[Error: /anotherdir/files/image.jpg is not inside <PROJECT_ROOT>/packages/gatsby/src/utils/__tests__. Make sure your files are inside your gatsby project.]`
        )
      }
    })

    it(`shouldn't augument a job twice`, () => {
      jest.doMock(`uuid/v4`)
      const uuid = require(`uuid/v4`)
      uuid.mockReturnValue(`1234`)
      const { createInternalJob } = getJobsManager()

      const internalJob = createInternalJob(createMockJob(), plugin, ROOT_DIR)
      createInternalJob(internalJob, plugin, ROOT_DIR)

      expect(uuid).toHaveBeenCalledTimes(1)
    })
  })

  describe(`enqueueJob`, () => {
    it(`should schedule a job`, async () => {
      const { enqueueJob } = getJobsManager()
      worker.TEST_JOB.mockReturnValue(`myresult`)
      worker.NEXT_JOB = jest.fn().mockReturnValue(`another result`)

      const mockedJob = createInternalMockJob()
      const job1 = enqueueJob(mockedJob)
      const job2 = enqueueJob(
        createInternalMockJob({
          inputPaths: [],
          name: `NEXT_JOB`,
        })
      )

      await Promise.all([
        expect(job1).resolves.toBe(`myresult`),
        expect(job2).resolves.toBe(`another result`),
      ])

      expect(endActivity).toHaveBeenCalledTimes(1)
      expect(worker.TEST_JOB).toHaveBeenCalledTimes(1)
      expect(worker.TEST_JOB).toHaveBeenCalledWith({
        inputPaths: mockedJob.inputPaths,
        outputDir: mockedJob.outputDir,
        args: mockedJob.args,
      })
      expect(worker.NEXT_JOB).toHaveBeenCalledTimes(1)
    })

    it(`should only enqueue a job once`, async () => {
      const { enqueueJob } = getJobsManager()
      const jobArgs = createInternalMockJob()
      const jobArgs2 = _.cloneDeep(jobArgs)
      const jobArgs3 = createInternalMockJob({
        args: {
          param2: `param2`,
          param1: `param1`,
        },
      })

      worker.TEST_JOB.mockReturnValue(`myresult`)

      const promises = []
      promises.push(enqueueJob(jobArgs))
      promises.push(enqueueJob(jobArgs2))
      promises.push(enqueueJob(jobArgs3))

      await expect(Promise.all(promises)).resolves.toStrictEqual([
        `myresult`,
        `myresult`,
        `myresult`,
      ])
      expect(pDefer).toHaveBeenCalledTimes(1) // this should be enough to check if our job is deterministic
      expect(endActivity).toHaveBeenCalledTimes(1)
      expect(worker.TEST_JOB).toHaveBeenCalledTimes(1)
    })

    it(`should fail when the worker throws an error`, async () => {
      const { enqueueJob } = getJobsManager()
      const jobArgs = createInternalMockJob()
      const jobArgs2 = createInternalMockJob({ inputPaths: [] })

      worker.TEST_JOB.mockImplementationOnce(() => {
        throw new Error(`An error occured`)
      }).mockImplementationOnce(() =>
        Promise.reject(new Error(`An error occured`))
      )

      expect.assertions(4)
      try {
        await enqueueJob(jobArgs)
      } catch (err) {
        expect(err).toMatchInlineSnapshot(`[Error: An error occured]`)
      }
      try {
        await enqueueJob(jobArgs2)
      } catch (err) {
        expect(err).toMatchInlineSnapshot(`[Error: An error occured]`)
      }
      expect(endActivity).toHaveBeenCalledTimes(2)
      expect(worker.TEST_JOB).toHaveBeenCalledTimes(2)
    })
  })

  describe(`waitUntilAllJobsComplete`, () => {
    const { enqueueJob, waitUntilAllJobsComplete } = getJobsManager()

    // unsure how to test this yet without a real worker
    it(`should have all tasks resolved when promise is resolved`, async () => {
      worker.TEST_JOB.mockReturnValue(`myresult`)
      const promise = enqueueJob(createInternalMockJob())

      await waitUntilAllJobsComplete()
      expect(worker.TEST_JOB).toHaveBeenCalledTimes(1)
      await expect(promise).resolves.toBe(`myresult`)
    })
  })

  describe(`isJobStale`, () => {
    it(`should mark a job as stale if file does not exists`, () => {
      const { isJobStale } = getJobsManager()
      const inputPaths = [
        {
          path: `unknown-file.jpg`,
          contentDigest: `1234`,
        },
      ]

      expect(isJobStale({ inputPaths }, ROOT_DIR)).toBe(true)
    })

    it(`should mark a job as stale if contentDigest isn't equal`, () => {
      const { isJobStale } = getJobsManager()
      const inputPaths = [
        {
          path: `fixtures/input1.jpg`,
          contentDigest: `1234`,
        },
      ]

      expect(isJobStale({ inputPaths }, ROOT_DIR)).toBe(true)
    })

    it(`shouldn't mark a job as stale if file is the same`, () => {
      jest.doMock(`hasha`)
      const hasha = require(`hasha`)
      hasha.fromFileSync.mockReturnValue(`1234`)

      const { isJobStale } = getJobsManager()
      const inputPaths = [
        {
          path: `fixtures/input1.jpg`,
          contentDigest: `1234`,
        },
      ]

      expect(isJobStale({ inputPaths }, ROOT_DIR)).toBe(false)
    })
  })
})
