/* Portuguese (Brazil). One file per area of the app; `common.js` holds the shared vocabulary and wins over the
   area files, so a term reads the same everywhere. */
import common from './common.js';
import core from './core.js';
import pagesAccount from './pages-account.js';
import pagesWork from './pages-work.js';
import overlaysForms from './overlays-forms.js';
import overlaysMenus from './overlays-menus.js';
import actionsMain from './actions-main.js';
import actionsMisc from './actions-misc.js';
import shellUi from './shell-ui.js';
import viewsFeatures from './views-features.js';

export default Object.assign({}, core, pagesAccount, pagesWork, overlaysForms, overlaysMenus, actionsMain, actionsMisc, shellUi, viewsFeatures, common);
