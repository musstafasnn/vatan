import {matchScore} from './turkishText.js';

const MAX_RESULTS = 5;

export function rankActions(actions, query) {
    return actions
        .map((action, order) => ({id: action.id, order, score: matchScore(action.title, action.keywords, query)}))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, MAX_RESULTS)
        .map(entry => entry.id);
}
