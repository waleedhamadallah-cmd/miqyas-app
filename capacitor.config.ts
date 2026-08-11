import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT: after you enable GitHub Pages (see README), replace the URL
// below with your real Pages address, then push once and rebuild the APK
// one last time. After that, editing docs/index.html and pushing is all
// you need — the already-installed app will load the new version the next
// time you open it, with no reinstall.
const config: CapacitorConfig = {
  appId: 'com.miqyas.app',
  appName: 'مقياس',
  webDir: 'www',
  server: {
    url: 'https://YOUR-GITHUB-USERNAME.github.io/miqyas-app/',
    cleartext: false
  }
};

export default config;
