import { SATS_PER_BTC } from "@config/app"

export const getAmount = (request): number | undefined => {
  return parsePaymentRequest({ request }).tokens
}

export const btc2sat = (btc: number) => {
  return Math.round(btc * SATS_PER_BTC)
}

export const sat2btc = (sat: number) => {
  return sat / SATS_PER_BTC
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function timeout(delay, msg) {
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      reject(new Error(msg))
    }, delay)
  })
}

/**
 * Process an iterator with N workers
 * @method async
 * @param  iterator iterator to process
 * @param  processor async function that process each item
 * @param  workers  number of workers to use. 5 by default
 * @param  logger  logger instance, just needed if you want to log processor errors
 * @return       Promise with all workers
 */
export const runInParallel = ({ iterator, processor, logger, workers = 5 }) => {
  const runWorkerInParallel = async (items, index) => {
    for await (const item of items) {
      try {
        await processor(item, index)
      } catch (error) {
        logger.error({ item, error }, `issue with worker ${index}`)
      }
    }
  }
  // starts N workers sharing the same iterator, i.e. process N items in parallel
  const jobWorkers = new Array(workers).fill(iterator).map(runWorkerInParallel)
  return Promise.allSettled(jobWorkers)
}
