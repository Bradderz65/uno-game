import { canPlayCard } from './game-rules.js';

/**
 * GameClient - Client-side game state management
 */
export class GameClient {
    constructor() {
        this.state = null;
        this.myPlayerId = null;
        this.isMyTurn = false;
    }

    setPlayerId(playerId) {
        this.myPlayerId = playerId;
        this.isMyTurn = this.state?.currentPlayerId === this.myPlayerId;
    }

    updateState(state, playerId = this.myPlayerId) {
        this.state = state;
        if (playerId) {
            this.myPlayerId = playerId;
        }
        this.isMyTurn = state.currentPlayerId === this.myPlayerId;
    }

    get hand() {
        return this.state?.hand || [];
    }

    get topCard() {
        return this.state?.topCard;
    }

    get currentColor() {
        return this.state?.currentColor;
    }

    get players() {
        return this.state?.players || [];
    }

    get deckCount() {
        return this.state?.deckCount || 0;
    }

    get drawStack() {
        return this.state?.drawStack || 0;
    }

    get direction() {
        return this.state?.direction || 1;
    }

    getPlayableCards() {
        if (!this.isMyTurn) return [];

        return this.hand.filter(card => this.canPlay(card));
    }

    canPlay(card) {
        return canPlayCard(card, this.topCard, this.currentColor, this.drawStack);
    }

    shouldCallUno() {
        return this.hand.length === 1 && this.isMyTurn && !this.state?.hasCalledUno;
    }

    getOpponents() {
        return this.players.filter(p => p.id !== this.myPlayerId);
    }

    getCurrentPlayer() {
        return this.players.find(p => p.isCurrentTurn);
    }
}
