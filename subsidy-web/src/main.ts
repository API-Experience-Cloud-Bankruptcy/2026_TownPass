import { createApp } from 'vue'
import './tokens.css'
import './style.css'
import './motion.css'
import App from './App.vue'
import { installLinkHandler } from './townpass/links'
import { installSmoothDetails } from './chat/smooth-details'

installLinkHandler()
installSmoothDetails()
createApp(App).mount('#app')
