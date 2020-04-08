import App from "./components/App";
import "./styles.css";

const appComponent = (window.appComponent = App());

document.getElementById("root").append(appComponent.element.element);
