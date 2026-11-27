import DefaultTheme from 'vitepress/theme'
import DeployButton from './components/DeployButton.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DeployButton', DeployButton)
  },
}
