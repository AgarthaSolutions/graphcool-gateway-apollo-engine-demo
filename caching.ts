require('dotenv').config()

import * as express from 'express'
import * as cors from 'cors'
import * as bodyParser from 'body-parser'
import { graphqlExpress } from 'apollo-server-express'
import { makeRemoteExecutableSchema, introspectSchema, mergeSchemas } from 'graphql-tools'
//import { transformSchema } from 'graphql-transform-schema'
import { HttpLink } from 'apollo-link-http'
import fetch from 'node-fetch'
import { expressPlayground } from 'graphql-playground-middleware'
import { Engine } from 'apollo-engine'

async function run() {

  // Create and start Apollo Engine instance
  // The typings for Apollo Engine are incorrect, so resorting to 'any'
  const engineConfig: any = {
    apiKey: process.env.APOLLO_ENGINE_KEY!,
    "stores": [{
      "name": "embeddedCache",
      "inMemory": {
        "cacheSize": 10485760
      }
    }],
    "queryCache": {
      "publicFullQueryStore": "embeddedCache",
      "privateFullQueryStore": "embeddedCache"
    }
  }

  const engine = new Engine({ engineConfig: engineConfig, graphqlPort: 3000 })
  engine.start()

  // Create schemas from remote endpoints
  const postEndpoint = process.env.GRAPHCOOL_POST_ENDPOINT || 'https://api.graph.cool/simple/v1/apollo-engine-demo-posts'
  const postLink = new HttpLink({ uri: postEndpoint, fetch })
  const postSchema = makeRemoteExecutableSchema({
    schema: await introspectSchema(postLink),
    link: postLink,
  })

  const commentsEndpoint = process.env.GRAPHCOOL_COMMENT_ENDPOINT || 'https://api.graph.cool/simple/v1/apollo-engine-demo-comments'
  const commentsLink = new HttpLink({ uri: commentsEndpoint, fetch })
  const commentsSchema = makeRemoteExecutableSchema({
    schema: await introspectSchema(commentsLink),
    link: commentsLink,
  })

  // Extend the schemas to link them together
  // Define cache duration on the fields
  const linkTypeDefs = `
  extend type Post  {
    comments: [Comment] @cacheControl(maxAge: 240)
  }

  extend type Comment  {
    post: Post @cacheControl(maxAge: 240)
  }

  extend type Query {
    getPosts: [Post!]! @cacheControl(maxAge: 240)
  }`

  const schema = mergeSchemas({
  schemas: [postSchema, commentsSchema, linkTypeDefs],
  resolvers: mergeInfo => ({
    Query: {
      getPosts: {
        resolve(parent:any, args:any, context:any, info:any) {
          return mergeInfo.delegate('query', 'allPosts', { }, context, info)
        },
      },
    },
    Post: {
      comments: {
        fragment: `fragment PostFragment on Post { id }`,
        resolve(parent:any, args:any, context:any, info:any) {
          const postId = parent.id;
          return mergeInfo.delegate(
            'query', 'allComments', { filter: { postId }}, context, info
          )
        }
      }
    },
    Comment: {
      post: {
        fragment: `fragment CommentFragment on Comment { postId }`,
        resolve(parent:any, args:any, context:any, info:any) {
          const id = parent.id;
          return mergeInfo.delegate(
            'query', 'Post', { id }, context, info
          )
        }
      }
    }
  })
});

// Due to a bug in apollo-server, cacheDuration breaks if the original field is removed
// const filteredSchema = transformSchema(schema, {
//     allPosts: false,
// })

  const app = express()
  app.use(engine.expressMiddleware());
  app.use('/graphql', cors(), bodyParser.json(), graphqlExpress({ schema: schema, tracing: true, cacheControl: true }))
  app.use('/playground', expressPlayground({ endpoint: '/graphql' }))

  app.listen(3000, () => console.log('Server running. Open http://localhost:3000/playground to run queries.'))
}

run().catch(console.error.bind(console))
