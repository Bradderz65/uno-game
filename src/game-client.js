/**
 * GameClient - Client-side game state management
 */
export class GameClient {
    constructor(socket) {
        this.socket = socket;
        this.state = null;
        this.myPlayerId = null;
        this.isMyTurn = false;
    }

    updateState(state) {
        this.state = state;
        this.isMyTurn = state.currentPlayerId === this.socket.id;
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

        return this.hand.filter((card, index) => {
            return this.canPlay(card);
        });
    }

    canPlay(card) {
        if (!this.topCard || !this.currentColor) return false;

        // If there's a draw stack, can only stack
        if (this.drawStack > 0) {
            if (this.topCard.type === 'draw_two' && card.type === 'draw_two') return true;
            if (this.topCard.type === 'wild_draw_four' && card.type === 'wild_draw_four') return true;
            return false;
        }

        // Wild cards always playable
        if (card.type === 'wild' || card.type === 'wild_draw_four') {
            return true;
        }

        // Same color
        if (card.color === this.currentColor) {
            return true;
        }

        // Same type (for action cards)
        if (card.type !== 'number' && card.type === this.topCard.type) {
            return true;
        }

        // Same number
        if (card.type === 'number' && this.topCard.type === 'number' &&
            card.value === this.topCard.value) {
            return true;
        }

        return false;
    }

    shouldCallUno() {
        return this.hand.length === 2 && this.isMyTurn;
    }

    getOpponents() {
        return this.players.filter(p => p.id !== this.socket.id);
    }

    getCurrentPlayer() {
        return this.players.find(p => p.isCurrentTurn);
    }
}
