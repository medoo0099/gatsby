jest.mock(`../../utils/jobs-manager`)

const { isJobStale } = require(`../../utils/jobs-manager`)
const { internalActions, publicActions } = require(`../../redux/actions`)

jest.spyOn(internalActions, `removeStaleJob`)

const getStaleJobs = require(`../get-stale-jobs`)

describe(`get-stale-jobs`, () => {
  let state

  beforeEach(() => {
    state = {
      program: {
        directory: __dirname,
      },
      jobsV2: {
        done: new Map(),
        stale: new Map(),
      },
    }

    publicActions.createJobV2 = jest.fn()
    internalActions.removeStaleJob.mockClear()
  })

  it(`should remove stale jobs from done cache`, () => {
    const job = {
      inputPaths: [`src/myfile.js`],
    }

    state.jobsV2.done.set(`1234`, job)

    isJobStale.mockReturnValue(true)

    expect(getStaleJobs(state)).toMatchSnapshot()
    expect(internalActions.removeStaleJob).toHaveBeenCalledTimes(1)
    expect(internalActions.removeStaleJob).toHaveBeenCalledWith(`1234`)
    expect(publicActions.createJobV2).not.toHaveBeenCalled()
  })

  it(`should remove stale jobs from pending cache`, () => {
    const data = {
      job: {
        inputPaths: [`src/myfile.js`],
        contentDigest: `1234`,
      },
      plugin: {
        name: `test`,
        version: `1.0.0`,
      },
    }

    state.jobsV2.stale.set(`1234`, data)

    isJobStale.mockReturnValue(true)

    expect(getStaleJobs(state)).toMatchSnapshot()
    expect(internalActions.removeStaleJob).toHaveBeenCalledTimes(1)
    expect(internalActions.removeStaleJob).toHaveBeenCalledWith(`1234`)
    expect(publicActions.createJobV2).not.toHaveBeenCalled()
  })

  it(`should enqueue pending jobs`, () => {
    const data = {
      job: {
        inputPaths: [`src/myfile.js`],
        contentDigest: `1234`,
      },
      plugin: {
        name: `test`,
        version: `1.0.0`,
      },
    }

    state.jobsV2.stale.set(`1234`, data)

    isJobStale.mockReturnValue(false)

    expect(getStaleJobs(state)).toMatchSnapshot()
    expect(internalActions.removeStaleJob).toHaveBeenCalledTimes(0)
    expect(publicActions.createJobV2).toHaveBeenCalledTimes(1)
    expect(publicActions.createJobV2).toHaveBeenCalledWith(
      data.job,
      data.plugin
    )
  })
})
