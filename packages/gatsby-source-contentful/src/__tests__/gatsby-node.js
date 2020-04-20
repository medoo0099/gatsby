// This is more an integration test than it is a unit test. We try to mock as little as we can

jest.mock(`../fetch`)
jest.mock(`gatsby-core-utils`, () => {
  return {
    createContentDigest: () => `contentDigest`,
  }
})

const fetch = require(`../fetch`)
fetch.getSyncData = jest.fn() // generators aren't mocked by jest it seems
const gatsbyNode = require(`../gatsby-node`)
const normalize = require(`../normalize`)

const startersBlogFixture = require(`../__fixtures__/starter-blog-data`)

describe(`gatsby-node`, () => {
  const actions = {}
  const store = {}
  const cache = {}
  const getCache = jest.fn()
  const reporter = {
    info: jest.fn(),
  }
  const createNodeId = jest.fn(value => value)
  let currentNodeMap
  let getNodes = () => Array.from(currentNodeMap.values())
  let getNode = id => currentNodeMap.get(id)

  const fetchAll = (value, field) => {
    let result = {
      entries: [],
      assets: [],
      deletedEntries: [],
      deletedAssets: [],
    }
    value.forEach(v => {
      result = {
        entries: result.entries.concat(v.entries),
        assets: result.assets.concat(v.assets),
        deletedEntries: result.deletedEntries.concat(v.deletedEntries),
        deletedAssets: result.deletedAssets.concat(v.deletedAssets),
      }
    })

    return result
  }

  const getFieldValue = (value, locale, defaultLocale) =>
    value[locale] ?? value[defaultLocale]

  const createFetchMock = data => {
    // deep clone
    data = JSON.parse(JSON.stringify(data))
    fetch.getContentTypes.mockImplementationOnce(() => data.contentTypeItems)
    fetch.getLocales.mockImplementationOnce(() => {
      return { defaultLocale: `en-US`, locales: data.locales }
    })
    fetch.getSyncData.mockImplementationOnce(async function* () {
      while (data.currentSyncData.length) {
        yield data.currentSyncData.shift()
      }
    })
    fetch.getSpace.mockImplementationOnce(() => data.space)
  }

  const testIfContentTypesExists = contentTypeItems => {
    contentTypeItems.forEach(contentType => {
      const contentTypeId = createNodeId(contentType.name)
      expect(getNode(contentTypeId)).toMatchObject({
        name: contentType.name,
        displayField: contentType.displayField,
        description: contentType.description,
      })
    })
  }

  const testIfEntriesExists = (entries, contentTypes, locales) => {
    const defaultLocale = locales[0]

    const nodeMap = new Map()
    const references = new Map()
    locales.forEach(locale => {
      entries.forEach(entry => {
        const currentContentType = contentTypes.find(
          contentType => contentType.sys.id === entry.sys.contentType.sys.id
        )

        const nodeId = createNodeId(
          normalize.makeId({
            spaceId: entry.sys.space.sys.id,
            defaultLocale: defaultLocale,
            currentLocale: locale,
            id: entry.sys.id,
          })
        )

        const matchedObject = {}
        Object.keys(entry.fields).forEach(field => {
          const value = getFieldValue(
            entry.fields[field],
            locale,
            defaultLocale
          )

          const fieldDefinition = currentContentType.fields.find(
            cField => cField.id === field
          )
          switch (fieldDefinition.type) {
            case `Link`: {
              const linkId = createNodeId(
                normalize.makeId({
                  spaceId: entry.sys.space.sys.id,
                  defaultLocale: defaultLocale,
                  currentLocale: locale,
                  id: value.sys.id,
                })
              )
              matchedObject[`${field}___NODE`] = linkId

              if (
                value.sys.type !== `Asset` &&
                value.sys.linkType !== `Asset`
              ) {
                if (!references.has(linkId)) {
                  references.set(linkId, {})
                }

                const referenceKey = `${currentContentType.name.toLowerCase()}___NODE`
                const reference = references.get(linkId)
                const linkedNode = getNode(linkId)

                reference[referenceKey] =
                  reference[referenceKey] || linkedNode[referenceKey] || []
                reference[referenceKey].push(nodeId)
                references.set(linkId, reference)
              }
              break
            }
            case `Text`: {
              const linkId = createNodeId(`${nodeId}${field}TextNode`)
              matchedObject[`${field}___NODE`] = linkId
              break
            }
            default:
              matchedObject[field] = value
          }
        })

        nodeMap.set(nodeId, matchedObject)
      })

      // update all matchedObjets with our backreferences
      for (const [nodeId, value] of references) {
        const matchedObject = {
          ...nodeMap.get(nodeId),
          ...value,
        }

        nodeMap.set(nodeId, matchedObject)
      }

      // match all entry nodes
      for (const [nodeId, matchedObject] of nodeMap) {
        expect(getNode(nodeId)).toMatchObject(matchedObject)
      }
    })
  }

  const testIfEntriesDeleted = (deletedEntries, locales) => {
    const defaultLocale = locales[0]

    locales.forEach(locale => {
      deletedEntries.forEach(entry => {
        const nodeId = createNodeId(
          normalize.makeId({
            spaceId: entry.sys.space.sys.id,
            defaultLocale: defaultLocale,
            currentLocale: locale,
            id: entry.sys.id,
          })
        )

        // check if all deleted nodes are gone
        expect(getNode(nodeId)).toBeUndefined()

        // check if all references got removed references should be removed
        for (const value of currentNodeMap.values()) {
          Object.keys(value).forEach(field => {
            if (field.endsWith(`___NODE`)) {
              expect([].concat(value[field])).not.toContain(nodeId)
            }
          })
        }
      })
    })
  }

  const testIfAssetsExists = (assets, locales) => {
    const defaultLocale = locales[0]
    locales.forEach(locale => {
      assets.forEach(asset => {
        const assetId = createNodeId(
          normalize.makeId({
            spaceId: asset.sys.space.sys.id,
            defaultLocale: defaultLocale,
            currentLocale: locale,
            id: asset.sys.id,
          })
        )

        // check if asset exists
        expect(getNode(assetId)).toMatchObject({
          title: getFieldValue(asset.fields.title, locale, defaultLocale),
          description: getFieldValue(
            asset.fields.description,
            locale,
            defaultLocale
          ),
          file: getFieldValue(asset.fields.file, locale, defaultLocale),
        })
      })
    })
  }

  const testIfAssetsDeleted = (deletedAssets, locales) => {
    const defaultLocale = locales[0]

    locales.forEach(locale => {
      deletedAssets.forEach(asset => {
        const assetId = createNodeId(
          normalize.makeId({
            spaceId: asset.sys.space.sys.id,
            defaultLocale: defaultLocale,
            currentLocale: locale,
            id: asset.sys.id,
          })
        )

        // check if asset got removed
        expect(getNode(assetId)).toBeUndefined()
      })
    })
  }

  beforeEach(() => {
    currentNodeMap = new Map()
    actions.createNode = jest.fn(async node => {
      node.internal.owner = `gatsby-source-contentful`
      // don't allow mutations (this isn't traversing so only top level is frozen)
      currentNodeMap.set(node.id, Object.freeze(node))
    })
    actions.deleteNode = ({ node }) => {
      currentNodeMap.delete(node.id)
    }
    actions.touchNode = jest.fn()
    actions.setPluginStatus = jest.fn()
    store.getState = jest.fn(() => {
      return {
        status: {},
      }
    })
  })

  it(`should create nodes from initial payload`, async () => {
    createFetchMock(startersBlogFixture.initialSync)
    const locales = [`en-US`, `nl`]
    const syncData = fetchAll(startersBlogFixture.initialSync.currentSyncData)

    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    testIfContentTypesExists(startersBlogFixture.initialSync.contentTypeItems)
    testIfEntriesExists(
      syncData.entries,
      startersBlogFixture.initialSync.contentTypeItems,
      locales
    )
    testIfAssetsExists(syncData.assets, locales)
  })

  it(`should add a new blogpost and update linkedNodes`, async () => {
    const locales = [`en-US`, `nl`]

    createFetchMock(startersBlogFixture.initialSync)
    createFetchMock(startersBlogFixture.createBlogPost)

    const syncData = fetchAll(
      startersBlogFixture.createBlogPost.currentSyncData
    )
    const createdBlogEntry = syncData.entries[0]
    const createdBlogEntryIds = locales.map(locale =>
      normalize.makeId({
        spaceId: createdBlogEntry.sys.space.sys.id,
        currentLocale: locale,
        defaultLocale: locales[0],
        id: createdBlogEntry.sys.id,
      })
    )

    // initial sync
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    // check if blog posts do not exists
    createdBlogEntryIds.forEach(entryId => {
      expect(getNode(entryId)).toBeUndefined()
    })

    // add new blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    testIfContentTypesExists(
      startersBlogFixture.createBlogPost.contentTypeItems
    )
    testIfEntriesExists(
      syncData.entries,
      startersBlogFixture.createBlogPost.contentTypeItems,
      locales
    )
    testIfAssetsExists(syncData.assets, locales)

    createdBlogEntryIds.forEach(blogEntryId => {
      const blogEntry = getNode(blogEntryId)
      expect(blogEntry).toMatchSnapshot()
      expect(getNode(blogEntry[`author___NODE`])).toMatchSnapshot()
    })
  })

  it(`should update a blogpost`, async () => {
    const locales = [`en-US`, `nl`]

    createFetchMock(startersBlogFixture.initialSync)
    createFetchMock(startersBlogFixture.createBlogPost)
    createFetchMock(startersBlogFixture.updateBlogPost)

    const syncData = fetchAll(
      startersBlogFixture.updateBlogPost.currentSyncData
    )
    const updatedBlogEntry = syncData.entries[0]
    const updatedBlogEntryIds = locales.map(locale =>
      normalize.makeId({
        spaceId: updatedBlogEntry.sys.space.sys.id,
        currentLocale: locale,
        defaultLocale: locales[0],
        id: updatedBlogEntry.sys.id,
      })
    )

    // initial sync
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    // create blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    updatedBlogEntryIds.forEach(blogEntryId => {
      expect(getNode(blogEntryId).title).toBe(`Hello world`)
    })

    // updated blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    testIfContentTypesExists(
      startersBlogFixture.updateBlogPost.contentTypeItems
    )
    testIfEntriesExists(
      syncData.entries,
      startersBlogFixture.updateBlogPost.contentTypeItems,
      locales
    )
    testIfAssetsExists(syncData.assets, locales)

    updatedBlogEntryIds.forEach(blogEntryId => {
      const blogEntry = getNode(blogEntryId)
      expect(blogEntry.title).toBe(`Hello world 1234`)
      expect(blogEntry).toMatchSnapshot()
      expect(getNode(blogEntry[`author___NODE`])).toMatchSnapshot()
    })
  })

  it(`should remove a blogpost and update linkedNodes`, async () => {
    const locales = [`en-US`, `nl`]
    createFetchMock(startersBlogFixture.initialSync)
    createFetchMock(startersBlogFixture.createBlogPost)
    createFetchMock(startersBlogFixture.removeBlogPost)

    const syncData = fetchAll(
      startersBlogFixture.removeBlogPost.currentSyncData
    )
    const removedBlogEntry = syncData.deletedEntries[0]
    const removedBlogEntryIds = locales.map(locale =>
      normalize.makeId({
        spaceId: removedBlogEntry.sys.space.sys.id,
        currentLocale: locale,
        defaultLocale: locales[0],
        id: removedBlogEntry.sys.id,
      })
    )

    // initial sync
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    // create blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    let authorIds = []
    // check if blog post exists
    removedBlogEntryIds.forEach(entryId => {
      const blogEntry = getNode(entryId)
      authorIds.push(blogEntry[`author___NODE`])
      expect(blogEntry).not.toBeUndefined()
    })

    // remove blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    testIfContentTypesExists(
      startersBlogFixture.removeBlogPost.contentTypeItems
    )
    testIfEntriesDeleted(syncData.assets, locales)

    // check if references are gone
    authorIds.forEach(authorId => {
      expect(getNode(authorId)).toMatchSnapshot()
    })
  })

  // this isn't implemented
  it.skip(`should remove an asset`, async () => {
    const locales = [`en-US`, `nl`]

    createFetchMock(startersBlogFixture.initialSync)
    createFetchMock(startersBlogFixture.createBlogPost)
    createFetchMock(startersBlogFixture.removeAsset)

    const syncData = fetchAll(
      startersBlogFixture.removeBlogPost.currentSyncData
    )
    const removedAssetEntry = syncData.deletedEntries[0]
    const removedAssetEntryIds = locales.map(locale =>
      normalize.makeId({
        spaceId: removedAssetEntry.sys.space.sys.id,
        currentLocale: locale,
        defaultLocale: locales[0],
        id: removedAssetEntry.sys.id,
      })
    )

    // initial sync
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    // create blog post
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    // check if blog post exists
    removedAssetEntryIds.forEach(assetId => {
      expect(getNode(assetId)).not.toBeUndefined()
    })

    // remove asset
    await gatsbyNode.sourceNodes({
      actions,
      store,
      getNodes,
      getNode,
      reporter,
      createNodeId,
      cache,
      getCache,
    })

    testIfContentTypesExists(startersBlogFixture.removeAsset.contentTypeItems)
    testIfEntriesExists(
      syncData.entries,
      startersBlogFixture.removeAsset.contentTypeItems,
      locales
    )
    testIfEntriesDeleted(syncData.assets, locales)
    testIfAssetsDeleted(syncData.assets, locales)
  })
})
