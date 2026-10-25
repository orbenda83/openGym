// Where this copy of the app came from, which decides who installs its updates:
//   'sideload' the APK from GitHub or opengym.ch: it checks GitHub and installs updates itself
//   'manual'   locally signed Orbenda APK, updated manually without the upstream updater
//   'play'     Google Play, which updates it (and does not allow an app to update itself)
//   'appstore' the iPhone app, updated by the App Store
//   'web'      the browser, updated with its server
// Android says which build it is (ChannelPlugin.java, the build flavour). An APK from before the
// plugin existed cannot identify its publisher here: fail closed to manual updates.
import { MOBILE } from './mobile.js'

let channelP = null
export function getChannel() {
  return channelP || (channelP = (async () => {
    if (!MOBILE) return 'web'
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    const platform = Capacitor.getPlatform()
    if (platform === 'ios') return 'appstore'
    if (platform !== 'android') return 'web'
    try {
      const { channel } = await registerPlugin('Channel').get()
      return channel === 'sideload' || channel === 'play' ? channel : 'manual'
    } catch {
      return 'manual'
    }
  })().catch(() => 'web'))
}

// The in-app updater is for the sideloaded APK only.
export async function selfUpdates() {
  return (await getChannel()) === 'sideload'
}

export function resetChannel() { channelP = null }
