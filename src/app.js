import { startWorkspace } from "./app/workspace.js";
import { installControls } from "./shared/controls.js";
import { installArticleMedia } from "./shared/article-media-runtime.js";
import { installTooltips } from "./shared/tooltips.js";
installTooltips();
installArticleMedia();
installControls();
startWorkspace();
