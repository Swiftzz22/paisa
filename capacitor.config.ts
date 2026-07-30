import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config — wraps paisa as a native app.
 *
 * paisa is a server-rendered Next.js app (dynamic routes), so it can't be
 * static-exported; the native shell loads the deployed site directly. Change
 * `server.url` to your own deployment (or a LAN dev URL like
 * http://192.168.x.x:3000 while testing).
 */
const config: CapacitorConfig = {
  appId: "com.sania.paisa", // reverse-domain bundle id — pick your own
  appName: "paisa",
  webDir: "public", // required by Capacitor; unused when server.url is set
  server: {
    url: "https://paisa-tawny.vercel.app",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
