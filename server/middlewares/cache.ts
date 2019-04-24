import * as express from 'express'
import * as AsyncLock from 'async-lock'
import { parseDurationToMs } from '../helpers/core-utils'
import { Redis } from '../lib/redis'
import { logger } from '../helpers/logger'

const lock = new AsyncLock({ timeout: 5000 })

function cacheRoute (lifetimeArg: string | number) {
  const lifetime = parseDurationToMs(lifetimeArg)

  return async function (req: express.Request, res: express.Response, next: express.NextFunction) {
    const redisKey = Redis.Instance.generateCachedRouteKey(req)

    try {
      await lock.acquire(redisKey, async (done) => {
        const cached = await Redis.Instance.getCachedRoute(req)

        // Not cached
        if (!cached) {
          logger.debug('No cached results for route %s.', req.originalUrl)

          const sendSave = res.send.bind(res)
          const redirectSave = res.redirect.bind(res)

          res.send = (body) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
              const contentType = res.get('content-type')

              Redis.Instance.setCachedRoute(req, body, lifetime, contentType, res.statusCode)
                   .then(() => done())
                   .catch(err => {
                     logger.error('Cannot cache route.', { err })
                     return done(err)
                   })
            } else {
              done()
            }

            return sendSave(body)
          }

          res.redirect = url => {
            done()

            return redirectSave(url)
          }

          return next()
        }

        if (cached.contentType) res.set('content-type', cached.contentType)

        if (cached.statusCode) {
          const statusCode = parseInt(cached.statusCode, 10)
          if (!isNaN(statusCode)) res.status(statusCode)
        }

        logger.debug('Use cached result for %s.', req.originalUrl)
        res.send(cached.body).end()

        return done()
      })
    } catch (err) {
      logger.error('Cannot serve cached route.', { err })
      return next()
    }
  }
}

// ---------------------------------------------------------------------------

export {
  cacheRoute
}
