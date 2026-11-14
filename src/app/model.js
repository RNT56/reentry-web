import { emptyPortfolio } from "../domain/portfolio.js";
export function createWorkspaceModel() {
  return {
    state: emptyPortfolio(),
    page: "portfolio",
    selected: null,
    percent: 5,
    scenario: {},
    quotes: {},
    busy: false,
    currentUser: null,
  };
}
