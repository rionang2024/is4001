// Runs the forecast off the main thread: ~4,000 trees x 23 zones x 192 hours takes a few seconds.
import { compile } from './models.js'
import { runForecast } from './forecast.js'

const models = new Map()   // url -> compiled model (promise)

self.onmessage = async ({ data }) => {
  const { id, modelUrl, ...args } = data
  try {
    if (!models.has(modelUrl)) {
      models.set(modelUrl, fetch(modelUrl).then((r) => {
        if (!r.ok) throw new Error(`Could not load the model (${r.status}). Run "npm run data:live" first.`)
        return r.json()
      }).then(compile))
    }
    self.postMessage({ id, out: runForecast({ model: await models.get(modelUrl), ...args }) })
  } catch (e) {
    models.delete(modelUrl)
    self.postMessage({ id, error: e.message })
  }
}
