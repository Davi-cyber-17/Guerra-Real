const boardElement = document.getElementById("board");
const turnElement = document.getElementById("turn");
const messageElement = document.getElementById("message");
const newGameButton = document.getElementById("newGame");
const flipButton = document.getElementById("flipBoard");
const drawButton = document.getElementById("offerDraw");
const resignButton = document.getElementById("resign");
const promotionOverlay = document.getElementById("promotionOverlay");
const promotionChoices = document.getElementById("promotionChoices");
const capturedByWhiteEl = document.getElementById("capturedByWhite");
const capturedByBlackEl = document.getElementById("capturedByBlack");
const movesListEl = document.getElementById("movesList");

// Glifos sólidos para as duas cores (a cor é aplicada via CSS).
// O "\uFE0E" força apresentação em texto, evitando que iOS/Android desenhem o peão como emoji.
const SOLID = { k: "\u265A\uFE0E", q: "\u265B\uFE0E", r: "\u265C\uFE0E", b: "\u265D\uFE0E", n: "\u265E\uFE0E", p: "\u265F\uFE0E" };
const pieces = { w: SOLID, b: SOLID };

// Servidores de conexão (STUN + TURN). O TURN garante que PC <-> celular (4G/Wi-Fi/redes diferentes)
// consigam se conectar mesmo atrás de NAT. Para mais estabilidade, troque por um TURN seu.
const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
];

let board;
let currentPlayer;
let selected;
let gameOver;
let enPassantTarget;
let halfmoveClock;
let capturedPieces;
let moveHistory;
let lastMove;
let boardFlipped = false;
let undoStack;
let pendingPromotion;

// Modo de jogo: "local" ou "online"
let mode = "local";
let online = newOnlineState();

function createInitialBoard() {
    return [
        [
            {color:"b", type:"r"}, {color:"b", type:"n"}, {color:"b", type:"b"}, {color:"b", type:"q"},
            {color:"b", type:"k"}, {color:"b", type:"b"}, {color:"b", type:"n"}, {color:"b", type:"r"}
        ],
        Array(8).fill(null).map(() => ({color:"b", type:"p"})),
        Array(8).fill(null),
        Array(8).fill(null),
        Array(8).fill(null),
        Array(8).fill(null),
        Array(8).fill(null).map(() => ({color:"w", type:"p"})),
        [
            {color:"w", type:"r"}, {color:"w", type:"n"}, {color:"w", type:"b"}, {color:"w", type:"q"},
            {color:"w", type:"k"}, {color:"w", type:"b"}, {color:"w", type:"n"}, {color:"w", type:"r"}
        ]
    ];
}

function startGame(askConfirm) {
    if (askConfirm) {
        const confirmed = confirm("Começar um novo jogo? O progresso atual será perdido.");
        if (!confirmed) return;
    }

    board = createInitialBoard();
    currentPlayer = "w";
    selected = null;
    gameOver = false;
    enPassantTarget = null;
    halfmoveClock = 0;
    capturedPieces = { w: [], b: [] };
    moveHistory = [];
    lastMove = null;
    undoStack = [];
    pendingPromotion = null;

    messageElement.textContent = "";
    hidePromotionOverlay();
    updateTurn();
    renderAll();
}

function updateTurn() {
    let text = currentPlayer === "w" ? "Vez das Brancas" : "Vez das Pretas";

    if (mode === "online" && !gameOver) {
        text += currentPlayer === online.myColor ? " (sua vez)" : " (aguarde)";
    }

    turnElement.textContent = text;
}

function renderAll() {
    renderBoard();
    renderCaptured();
    renderMoveHistory();
}

function renderBoard() {
    boardElement.innerHTML = "";

    for (let visRow = 0; visRow < 8; visRow++) {
        for (let visCol = 0; visCol < 8; visCol++) {
            const row = boardFlipped ? 7 - visRow : visRow;
            const col = boardFlipped ? 7 - visCol : visCol;

            const square = document.createElement("div");
            square.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
            square.dataset.row = row;
            square.dataset.col = col;

            if (selected && selected.row === row && selected.col === col) {
                square.classList.add("selected");
            }

            if (lastMove && (
                (lastMove.from.row === row && lastMove.from.col === col) ||
                (lastMove.to.row === row && lastMove.to.col === col)
            )) {
                square.classList.add("last-move");
            }

            if (!gameOver && selected && getLegalMoves(selected.row, selected.col)
                .some(move => move.row === row && move.col === col)) {
                square.classList.add("possible");

                if (board[row][col]) {
                    square.classList.add("capture");
                }
            }

            const piece = board[row][col];

            if (piece && piece.type === "k" && isKingInCheck(piece.color)) {
                square.classList.add("check");
            }

            if (visCol === 0) {
                const rank = document.createElement("span");
                rank.className = "coord coord-rank";
                rank.textContent = 8 - row;
                square.appendChild(rank);
            }

            if (visRow === 7) {
                const file = document.createElement("span");
                file.className = "coord coord-file";
                file.textContent = "abcdefgh"[col];
                square.appendChild(file);
            }

            if (piece) {
                const span = document.createElement("span");
                span.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
                span.textContent = pieces[piece.color][piece.type];
                square.appendChild(span);
            }

            square.addEventListener("click", () => handleSquareClick(row, col));
            boardElement.appendChild(square);
        }
    }
}

function renderCapturedList(element, types, color) {
    element.innerHTML = "";

    types.forEach(type => {
        const span = document.createElement("span");
        span.className = `cp ${color === "w" ? "white-piece" : "black-piece"}`;
        span.textContent = pieces[color][type];
        element.appendChild(span);
    });
}

function renderCaptured() {
    renderCapturedList(capturedByWhiteEl, capturedPieces.w, "b");
    renderCapturedList(capturedByBlackEl, capturedPieces.b, "w");
}

function renderMoveHistory() {
    movesListEl.innerHTML = "";

    for (let i = 0; i < moveHistory.length; i += 2) {
        const li = document.createElement("li");
        const whiteMove = moveHistory[i] ? moveHistory[i].notation : "";
        const blackMove = moveHistory[i + 1] ? moveHistory[i + 1].notation : "";
        li.textContent = blackMove ? `${whiteMove}    ${blackMove}` : whiteMove;
        movesListEl.appendChild(li);
    }

    movesListEl.scrollTop = movesListEl.scrollHeight;
}

function handleSquareClick(row, col) {
    if (gameOver || pendingPromotion) return;

    // No modo online só é possível jogar quando conectado e na sua vez
    if (mode === "online" && (!online.connected || currentPlayer !== online.myColor)) return;

    const piece = board[row][col];

    if (!selected) {
        if (piece && piece.color === currentPlayer) {
            selected = { row, col };
            renderBoard();
        }
        return;
    }

    if (selected.row === row && selected.col === col) {
        selected = null;
        renderBoard();
        return;
    }

    const moves = getLegalMoves(selected.row, selected.col);
    const validMove = moves.find(move => move.row === row && move.col === col);

    if (validMove) {
        attemptMove(selected.row, selected.col, row, col);
    } else if (piece && piece.color === currentPlayer) {
        selected = { row, col };
        renderBoard();
    } else {
        selected = null;
        renderBoard();
    }
}

function attemptMove(fromRow, fromCol, toRow, toCol) {
    pushUndoSnapshot();

    const piece = board[fromRow][fromCol];
    const pieceType = piece.type;
    const isCastleMove = piece.type === "k" && Math.abs(toCol - fromCol) === 2;
    const isEnPassantMove = piece.type === "p" && enPassantTarget &&
        toRow === enPassantTarget.row && toCol === enPassantTarget.col &&
        !board[toRow][toCol];
    const capturedPiece = isEnPassantMove ? board[fromRow][toCol] : board[toRow][toCol];
    const isPawnMove = piece.type === "p";
    const fromSquare = squareName(fromRow, fromCol);
    const toSquare = squareName(toRow, toCol);

    makeMove(fromRow, fromCol, toRow, toCol);

    if (capturedPiece) {
        capturedPieces[currentPlayer].push(capturedPiece.type);
    }

    halfmoveClock = (isPawnMove || capturedPiece) ? 0 : halfmoveClock + 1;
    lastMove = { from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } };
    selected = null;

    const baseNotation = buildNotation({
        pieceType,
        isCastleMove,
        castleSide: isCastleMove ? (toCol > fromCol ? "king" : "queen") : null,
        isCapture: !!capturedPiece,
        fromSquare,
        toSquare
    });

    const promotionRow = piece.color === "w" ? 0 : 7;
    const needsPromotion = piece.type === "p" && toRow === promotionRow;

    if (needsPromotion) {
        pendingPromotion = { row: toRow, col: toCol, color: piece.color, baseNotation };
        renderBoard();
        showPromotionOverlay(piece.color);
        return;
    }

    finishTurn(baseNotation);
}

function showPromotionOverlay(color) {
    promotionChoices.innerHTML = "";

    for (const type of ["q", "r", "b", "n"]) {
        const btn = document.createElement("button");
        btn.className = `promotion-choice ${color === "w" ? "white-piece" : "black-piece"}`;
        btn.textContent = pieces[color][type];
        btn.addEventListener("click", () => resolvePromotion(type));
        promotionChoices.appendChild(btn);
    }

    promotionOverlay.classList.remove("hidden");
}

function hidePromotionOverlay() {
    promotionOverlay.classList.add("hidden");
}

function resolvePromotion(type) {
    const { row, col, baseNotation } = pendingPromotion;
    board[row][col].type = type;

    const promoLetters = { q: "Q", r: "R", b: "B", n: "N" };
    const notation = `${baseNotation}=${promoLetters[type]}`;

    pendingPromotion = null;
    hidePromotionOverlay();
    finishTurn(notation);
}

function finishTurn(notation) {
    const oppColor = opposite(currentPlayer);
    let suffix = "";
    let finalMessage = "";
    let endGame = false;

    if (isCheckmate(oppColor)) {
        endGame = true;
        suffix = "#";
        finalMessage = `${currentPlayer === "w" ? "Brancas" : "Pretas"} venceram por xeque-mate!`;
    } else if (isStalemate(oppColor)) {
        endGame = true;
        finalMessage = "Empate por afogamento!";
    } else if (halfmoveClock >= 100) {
        endGame = true;
        finalMessage = "Empate pela regra dos 50 lances!";
    } else if (isInsufficientMaterial()) {
        endGame = true;
        finalMessage = "Empate por material insuficiente!";
    } else if (isKingInCheck(oppColor)) {
        suffix = "+";
    }

    moveHistory.push({ color: currentPlayer, notation: notation + suffix });
    gameOver = endGame;
    messageElement.textContent = finalMessage || (suffix === "+" ? "XEQUE!" : "");

    if (!gameOver) {
        currentPlayer = oppColor;
        updateTurn();
    }

    renderAll();

    // Envia o estado atualizado para o oponente
    if (mode === "online") sendState();
}

function squareName(row, col) {
    return `${"abcdefgh"[col]}${8 - row}`;
}

function buildNotation({ pieceType, isCastleMove, castleSide, isCapture, fromSquare, toSquare }) {
    if (isCastleMove) {
        return castleSide === "king" ? "O-O" : "O-O-O";
    }

    const letters = { k: "K", q: "Q", r: "R", b: "B", n: "N" };

    if (pieceType === "p") {
        return isCapture ? `${fromSquare[0]}x${toSquare}` : toSquare;
    }

    return `${letters[pieceType]}${isCapture ? "x" : ""}${toSquare}`;
}

function isInsufficientMaterial() {
    const remaining = [];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = board[row][col];
            if (piece && piece.type !== "k") {
                remaining.push(piece);
            }
        }
    }

    if (remaining.length === 0) return true;
    if (remaining.length === 1 && (remaining[0].type === "b" || remaining[0].type === "n")) return true;

    return false;
}

function pushUndoSnapshot() {
    undoStack.push({
        board: cloneBoard(board),
        currentPlayer,
        enPassantTarget: enPassantTarget ? { ...enPassantTarget } : null,
        halfmoveClock,
        capturedPieces: { w: [...capturedPieces.w], b: [...capturedPieces.b] },
        moveHistory: moveHistory.map(m => ({ ...m })),
        lastMove: lastMove ? { from: { ...lastMove.from }, to: { ...lastMove.to } } : null,
        gameOver,
        message: messageElement.textContent
    });
}

function cloneBoard(source) {
    return source.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

function undoMove() {
    if (pendingPromotion || undoStack.length === 0) return;

    const snapshot = undoStack.pop();
    board = snapshot.board;
    currentPlayer = snapshot.currentPlayer;
    enPassantTarget = snapshot.enPassantTarget;
    halfmoveClock = snapshot.halfmoveClock;
    capturedPieces = snapshot.capturedPieces;
    moveHistory = snapshot.moveHistory;
    lastMove = snapshot.lastMove;
    gameOver = snapshot.gameOver;
    selected = null;

    messageElement.textContent = snapshot.message;
    updateTurn();
    renderAll();
}

function toggleFlip() {
    boardFlipped = !boardFlipped;
    renderBoard();
}

function offerDraw() {
    if (gameOver) return;

    const confirmed = confirm("Os dois jogadores concordam com o empate?");
    if (confirmed) {
        gameOver = true;
        messageElement.textContent = "Empate por acordo entre os jogadores!";
        renderAll();
    }
}

function resignGame() {
    if (gameOver) return;

    const playerName = currentPlayer === "w" ? "Brancas" : "Pretas";
    const confirmed = confirm(`${playerName} confirmam a desistência?`);

    if (confirmed) {
        gameOver = true;
        const winner = currentPlayer === "w" ? "Pretas" : "Brancas";
        messageElement.textContent = `${playerName} desistiram. ${winner} venceram!`;
        renderAll();
    }
}

function makeMove(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];

    if (piece.type === "p" && enPassantTarget &&
        toRow === enPassantTarget.row && toCol === enPassantTarget.col &&
        !board[toRow][toCol]) {
        board[fromRow][toCol] = null;
    }

    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = null;
    piece.moved = true;

    const wasDoubleStep = piece.type === "p" && Math.abs(toRow - fromRow) === 2;
    enPassantTarget = null;

    if (wasDoubleStep) {
        enPassantTarget = {
            row: (fromRow + toRow) / 2,
            col: fromCol
        };
    }

    if (piece.type === "k" && Math.abs(toCol - fromCol) === 2) {
        if (toCol > fromCol) {
            board[toRow][5] = board[toRow][7];
            board[toRow][7] = null;
            if (board[toRow][5]) board[toRow][5].moved = true;
        } else {
            board[toRow][3] = board[toRow][0];
            board[toRow][0] = null;
            if (board[toRow][3]) board[toRow][3].moved = true;
        }
    }
}

function getLegalMoves(row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const pseudoMoves = getPseudoMoves(row, col);
    const legalMoves = [];

    for (const move of pseudoMoves) {
        const original = board[move.row][move.col];
        const originalFrom = board[row][col];

        board[move.row][move.col] = originalFrom;
        board[row][col] = null;

        let enPassantCaptured = null;

        if (piece.type === "p" &&
            enPassantTarget &&
            move.row === enPassantTarget.row &&
            move.col === enPassantTarget.col &&
            !original) {
            enPassantCaptured = board[row][move.col];
            board[row][move.col] = null;
        }

        let rookData = null;

        if (piece.type === "k" && Math.abs(move.col - col) === 2) {
            const rookCol = move.col > col ? 7 : 0;
            const newRookCol = move.col > col ? 5 : 3;
            rookData = {
                rook: board[row][rookCol],
                rookCol,
                newRookCol
            };
            board[row][newRookCol] = board[row][rookCol];
            board[row][rookCol] = null;
        }

        if (!isKingInCheck(piece.color)) {
            legalMoves.push(move);
        }

        if (rookData) {
            board[row][rookData.rookCol] = rookData.rook;
            board[row][rookData.newRookCol] = null;
        }

        if (enPassantCaptured) {
            board[row][move.col] = enPassantCaptured;
        }

        board[row][col] = originalFrom;
        board[move.row][move.col] = original;
    }

    return legalMoves;
}

function getPseudoMoves(row, col) {
    const piece = board[row][col];
    const moves = [];

    if (piece.type === "p") {
        const direction = piece.color === "w" ? -1 : 1;
        const startRow = piece.color === "w" ? 6 : 1;

        if (inside(row + direction, col) && !board[row + direction][col]) {
            moves.push({row: row + direction, col});

            if (row === startRow && !board[row + direction * 2][col]) {
                moves.push({row: row + direction * 2, col});
            }
        }

        for (const dc of [-1, 1]) {
            const r = row + direction;
            const c = col + dc;

            if (!inside(r, c)) continue;

            if (board[r][c] && board[r][c].color !== piece.color) {
                if (board[r][c].type !== "k") {
                    moves.push({row:r, col:c});
                }
            }

            if (enPassantTarget && enPassantTarget.row === r && enPassantTarget.col === c) {
                moves.push({row:r, col:c});
            }
        }
    }

    if (piece.type === "n") {
        const jumps = [
            [-2,-1], [-2,1], [-1,-2], [-1,2],
            [1,-2], [1,2], [2,-1], [2,1]
        ];

        for (const [dr, dc] of jumps) {
            addIfValid(row + dr, col + dc, piece.color, moves);
        }
    }

    if (["b", "r", "q"].includes(piece.type)) {
        const directions = [];

        if (["b", "q"].includes(piece.type)) {
            directions.push([-1,-1], [-1,1], [1,-1], [1,1]);
        }

        if (["r", "q"].includes(piece.type)) {
            directions.push([-1,0], [1,0], [0,-1], [0,1]);
        }

        for (const [dr, dc] of directions) {
            let r = row + dr;
            let c = col + dc;

            while (inside(r, c)) {
                if (!board[r][c]) {
                    moves.push({row:r, col:c});
                } else {
                    if (board[r][c].color !== piece.color && board[r][c].type !== "k") {
                        moves.push({row:r, col:c});
                    }
                    break;
                }

                r += dr;
                c += dc;
            }
        }
    }

    if (piece.type === "k") {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                addIfValid(row + dr, col + dc, piece.color, moves, true);
            }
        }

        if (!hasMoved(piece) && !isKingInCheck(piece.color)) {
            if (canCastle(piece.color, "king")) {
                moves.push({row, col: col + 2});
            }

            if (canCastle(piece.color, "queen")) {
                moves.push({row, col: col - 2});
            }
        }
    }

    return moves;
}

function addIfValid(row, col, color, moves, kingMove = false) {
    if (!inside(row, col)) return;

    if (!board[row][col]) {
        moves.push({row, col});
    } else if (board[row][col].color !== color && board[row][col].type !== "k") {
        moves.push({row, col});
    }
}

function canCastle(color, side) {
    const row = color === "w" ? 7 : 0;
    const king = board[row][4];

    if (!king || king.type !== "k" || king.color !== color || hasMoved(king)) {
        return false;
    }

    const rookCol = side === "king" ? 7 : 0;
    const rook = board[row][rookCol];

    if (!rook || rook.type !== "r" || rook.color !== color || hasMoved(rook)) {
        return false;
    }

    const between = side === "king" ? [5,6] : [1,2,3];

    if (between.some(col => board[row][col])) {
        return false;
    }

    const attackSquares = side === "king" ? [5,6] : [3,2];

    for (const col of attackSquares) {
        if (squareIsAttacked(row, col, opposite(color))) {
            return false;
        }
    }

    return true;
}

function hasMoved(piece) {
    return piece.moved === true;
}

function isKingInCheck(color) {
    let kingPosition = null;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = board[row][col];
            if (piece && piece.color === color && piece.type === "k") {
                kingPosition = {row, col};
                break;
            }
        }
        if (kingPosition) break;
    }

    if (!kingPosition) return true;

    return squareIsAttacked(
        kingPosition.row,
        kingPosition.col,
        opposite(color)
    );
}

function squareIsAttacked(row, col, attackerColor) {
    const pawnDirection = attackerColor === "w" ? -1 : 1;

    for (const dc of [-1, 1]) {
        const r = row - pawnDirection;
        const c = col - dc;

        if (inside(r, c) &&
            board[r][c] &&
            board[r][c].color === attackerColor &&
            board[r][c].type === "p") {
            return true;
        }
    }

    const knightMoves = [
        [-2,-1], [-2,1], [-1,-2], [-1,2],
        [1,-2], [1,2], [2,-1], [2,1]
    ];

    for (const [dr, dc] of knightMoves) {
        const r = row + dr;
        const c = col + dc;

        if (inside(r, c) &&
            board[r][c] &&
            board[r][c].color === attackerColor &&
            board[r][c].type === "n") {
            return true;
        }
    }

    const diagonal = [[-1,-1],[-1,1],[1,-1],[1,1]];

    for (const [dr, dc] of diagonal) {
        let r = row + dr;
        let c = col + dc;

        while (inside(r, c)) {
            const piece = board[r][c];

            if (piece) {
                if (piece.color === attackerColor &&
                    (piece.type === "b" || piece.type === "q")) {
                    return true;
                }
                break;
            }

            r += dr;
            c += dc;
        }
    }

    const straight = [[-1,0],[1,0],[0,-1],[0,1]];

    for (const [dr, dc] of straight) {
        let r = row + dr;
        let c = col + dc;

        while (inside(r, c)) {
            const piece = board[r][c];

            if (piece) {
                if (piece.color === attackerColor &&
                    (piece.type === "r" || piece.type === "q")) {
                    return true;
                }
                break;
            }

            r += dr;
            c += dc;
        }
    }

    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;

            const r = row + dr;
            const c = col + dc;

            if (inside(r, c) &&
                board[r][c] &&
                board[r][c].color === attackerColor &&
                board[r][c].type === "k") {
                return true;
            }
        }
    }

    return false;
}

function isCheckmate(color) {
    return isKingInCheck(color) && !hasAnyLegalMove(color);
}

function isStalemate(color) {
    return !isKingInCheck(color) && !hasAnyLegalMove(color);
}

function hasAnyLegalMove(color) {
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (board[row][col] && board[row][col].color === color) {
                if (getLegalMoves(row, col).length > 0) {
                    return true;
                }
            }
        }
    }

    return false;
}

function opposite(color) {
    return color === "w" ? "b" : "w";
}

function inside(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}


/* =====================================================================
   MENU, SALAS E MODO ONLINE (WebRTC via PeerJS — não precisa de servidor)
   ===================================================================== */

const menuScreen = document.getElementById("menuScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const btnLocal = document.getElementById("btnLocal");
const btnOnline = document.getElementById("btnOnline");
const hostColorSelect = document.getElementById("hostColor");
const createRoomBtn = document.getElementById("createRoom");
const createdBox = document.getElementById("createdBox");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const copyCodeBtn = document.getElementById("copyCode");
const copyLinkBtn = document.getElementById("copyLink");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomBtn = document.getElementById("joinRoom");
const lobbyStatus = document.getElementById("lobbyStatus");
const lobbyBackBtn = document.getElementById("lobbyBack");
const backToMenuBtn = document.getElementById("backToMenu");
const roomBar = document.getElementById("roomBar");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const myColorLabel = document.getElementById("myColorLabel");
const connStatus = document.getElementById("connStatus");
const roomNotice = document.getElementById("roomNotice");
const infoMode = document.getElementById("infoMode");
const modalEl = document.getElementById("modal");
const modalText = document.getElementById("modalText");
const modalButtons = document.getElementById("modalButtons");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PEER_PREFIX = "xadrez-sala-";
let noticeTimer = null;

function newOnlineState() {
    return {
        peer: null,
        conn: null,
        myColor: null,
        connected: false,
        isHost: false,
        code: null,
        joinTimer: null,
        lastSeen: 0
    };
}

function colorName(color) {
    return color === "w" ? "Brancas" : "Pretas";
}

function randomCode() {
    let code = "";
    for (let i = 0; i < 5; i++) {
        code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    return code;
}

/* ---------- Telas ---------- */

function showScreen(name) {
    menuScreen.classList.toggle("hidden", name !== "menu");
    lobbyScreen.classList.toggle("hidden", name !== "lobby");
    gameScreen.classList.toggle("hidden", name !== "game");
}

function setLobbyStatus(text, isError = false) {
    lobbyStatus.textContent = text;
    lobbyStatus.classList.toggle("error", isError);
}

function resetLobbyUI() {
    createdBox.classList.add("hidden");
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    setLobbyStatus("");
}

function notice(text) {
    roomNotice.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { roomNotice.textContent = ""; }, 5000);
}

function showModal(text, buttons) {
    modalText.textContent = text;
    modalButtons.innerHTML = "";

    buttons.forEach(b => {
        const el = document.createElement("button");
        el.textContent = b.label;
        if (b.secondary) el.className = "secondary";
        el.addEventListener("click", () => {
            hideModal();
            if (b.onClick) b.onClick();
        });
        modalButtons.appendChild(el);
    });

    modalEl.classList.remove("hidden");
}

function hideModal() {
    modalEl.classList.add("hidden");
}

async function copyText(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        prompt("Copie o texto abaixo:", text);
        return;
    }

    const old = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(() => { btn.textContent = old; }, 1500);
}

/* ---------- Iniciar modos ---------- */

function startLocal() {
    resetOnline();
    mode = "local";
    boardFlipped = false;
    roomBar.classList.add("hidden");
    roomNotice.textContent = "";
    infoMode.textContent = "Partida local para 2 jogadores no mesmo computador.";
    startGame(false);
    showScreen("game");
}

function openLobby() {
    resetOnline();
    resetLobbyUI();
    showScreen("lobby");
}

function backToMenu() {
    hideModal();
    resetOnline();
    resetLobbyUI();
    mode = "local";
    showScreen("menu");
}

function enterOnlineGame() {
    mode = "online";
    boardFlipped = online.myColor === "b";
    clearTimeout(online.joinTimer);

    startGame(false);

    roomCodeLabel.textContent = online.code;
    myColorLabel.textContent = colorName(online.myColor);
    setConnStatus("ok");
    startHeartbeat();
    requestWakeLock();
    roomBar.classList.remove("hidden");
    roomNotice.textContent = "";
    infoMode.textContent = "Partida online: você só move suas peças, na sua vez.";

    resetLobbyUI();
    showScreen("game");
}

function setConnStatus(state) {
    const labels = { ok: "● Conectado", weak: "● Conexão instável", off: "● Desconectado" };
    connStatus.textContent = labels[state];
    connStatus.classList.toggle("weak", state === "weak");
    connStatus.classList.toggle("off", state === "off");
}

/* ---------- Conexão (PeerJS) ---------- */

function ensurePeerLib() {
    if (typeof Peer === "undefined") {
        setLobbyStatus("Não foi possível carregar a biblioteca de conexão online (PeerJS). Verifique sua internet.", true);
        return false;
    }
    return true;
}

function peerOptions() {
    return { debug: 0, config: { iceServers: ICE_SERVERS, sdpSemantics: "unified-plan" } };
}

function resetOnline() {
    stopHeartbeat();
    releaseWakeLock();
    clearTimeout(online.joinTimer);
    try { if (online.conn) online.conn.close(); } catch (e) {}
    try { if (online.peer) online.peer.destroy(); } catch (e) {}
    online = newOnlineState();
}

function createRoom(attempt = 0) {
    if (!ensurePeerLib()) return;

    const choice = hostColorSelect.value;
    resetOnline();

    online.isHost = true;
    online.myColor = choice === "random" ? (Math.random() < 0.5 ? "w" : "b") : choice;
    online.code = randomCode();

    createRoomBtn.disabled = true;
    setLobbyStatus("Criando sala...");

    const peer = new Peer(PEER_PREFIX + online.code, peerOptions());
    online.peer = peer;

    peer.on("open", () => {
        roomCodeDisplay.textContent = online.code;
        createdBox.classList.remove("hidden");
        setLobbyStatus("");
    });

    peer.on("connection", conn => {
        if (online.conn) {
            // sala já tem 2 jogadores
            conn.on("open", () => {
                conn.send({ type: "full" });
                setTimeout(() => conn.close(), 300);
            });
            return;
        }

        online.conn = conn;
        setupConn(conn);

        conn.on("open", () => {
            online.connected = true;
            conn.send({ type: "start", color: opposite(online.myColor) });
            enterOnlineGame();
        });
    });

    peer.on("disconnected", () => {
        if (!peer.destroyed) peer.reconnect();
    });

    peer.on("error", err => {
        if (online.connected) return;

        if (err.type === "unavailable-id" && attempt < 5) {
            createRoom(attempt + 1);
            return;
        }

        resetOnline();
        resetLobbyUI();
        setLobbyStatus("Erro ao criar a sala. Tente novamente.", true);
    });
}

function joinRoom() {
    if (!ensurePeerLib()) return;

    const code = roomCodeInput.value.trim().toUpperCase();

    if (code.length < 4) {
        setLobbyStatus("Digite o código da sala.", true);
        return;
    }

    resetOnline();
    online.isHost = false;
    online.code = code;

    joinRoomBtn.disabled = true;
    setLobbyStatus("Conectando à sala...");

    const peer = new Peer(undefined, peerOptions());
    online.peer = peer;

    online.joinTimer = setTimeout(() => {
        if (!online.connected) {
            resetOnline();
            resetLobbyUI();
            setLobbyStatus("Não foi possível conectar à sala. Verifique o código e tente novamente.", true);
        }
    }, 15000);

    peer.on("open", () => {
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "json" });
        online.conn = conn;
        setupConn(conn);
    });

    peer.on("error", err => {
        if (online.connected) return;

        const text = err.type === "peer-unavailable"
            ? "Sala não encontrada. Confira o código."
            : "Erro de conexão. Tente novamente.";

        resetOnline();
        resetLobbyUI();
        setLobbyStatus(text, true);
    });
}

function setupConn(conn) {
    conn.on("data", handleMessage);
    conn.on("close", onConnClosed);
    conn.on("error", onConnClosed);
}

function onConnClosed() {
    if (!online.connected) return;

    online.connected = false;
    stopHeartbeat();
    setConnStatus("off");

    if (mode === "online") {
        showModal("Seu oponente saiu da sala.", [
            { label: "Voltar ao menu", onClick: backToMenu },
            { label: "Ver tabuleiro", secondary: true }
        ]);
    }
}

function send(msg) {
    if (online.conn && online.connected) {
        online.conn.send(msg);
    }
}

/* ---------- Sincronização do estado ---------- */

function getState() {
    return {
        board: cloneBoard(board),
        currentPlayer,
        enPassantTarget: enPassantTarget ? { ...enPassantTarget } : null,
        halfmoveClock,
        capturedPieces: { w: [...capturedPieces.w], b: [...capturedPieces.b] },
        moveHistory: moveHistory.map(m => ({ ...m })),
        lastMove: lastMove ? { from: { ...lastMove.from }, to: { ...lastMove.to } } : null,
        gameOver,
        message: messageElement.textContent
    };
}

function loadState(state) {
    board = state.board;
    currentPlayer = state.currentPlayer;
    enPassantTarget = state.enPassantTarget;
    halfmoveClock = state.halfmoveClock;
    capturedPieces = state.capturedPieces;
    moveHistory = state.moveHistory;
    lastMove = state.lastMove;
    gameOver = state.gameOver;
    selected = null;
    pendingPromotion = null;

    hidePromotionOverlay();
    messageElement.textContent = state.message || "";
    updateTurn();
    renderAll();
}

function sendState() {
    send({ type: "state", state: getState() });
}

/* ---------- Estabilidade em celulares ---------- */

let heartbeatTimer = null;
let wakeLock = null;

function startHeartbeat() {
    stopHeartbeat();
    online.lastSeen = Date.now();

    heartbeatTimer = setInterval(() => {
        if (!online.connected) return;

        send({ type: "ping" });

        const silent = Date.now() - online.lastSeen;

        if (silent > 60000) {
            onConnClosed();
        } else if (silent > 15000) {
            setConnStatus("weak");
        } else {
            setConnStatus("ok");
        }
    }, 4000);
}

function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

async function requestWakeLock() {
    try {
        if ("wakeLock" in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", () => { wakeLock = null; });
        }
    } catch (e) {}
}

function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
}

// Se o celular ficou em segundo plano e perdeu algum lance, o tabuleiro é ressincronizado
function applySync(state) {
    if (!state || pendingPromotion) return;

    const diff = state.moveHistory.length - moveHistory.length;
    const different = JSON.stringify(state.board) !== JSON.stringify(board) ||
        state.gameOver !== gameOver || state.currentPlayer !== currentPlayer;

    if (diff < 0 || (diff === 0 && !different)) return;

    if (diff === 1) pushUndoSnapshot();
    else if (diff > 1) undoStack = [];

    loadState(state);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && mode === "online" && online.connected) {
        online.lastSeen = Date.now();
        requestWakeLock();
        send({ type: "sync-request" });
    }
});

/* ---------- Ações online ---------- */

function applyDraw() {
    gameOver = true;
    selected = null;
    messageElement.textContent = "Empate por acordo entre os jogadores!";
    updateTurn();
    renderAll();
}

function applyResign(color) {
    gameOver = true;
    selected = null;
    messageElement.textContent = `${colorName(color)} desistiram. ${colorName(opposite(color))} venceram!`;
    updateTurn();
    renderAll();
}

function startRematch() {
    online.myColor = opposite(online.myColor);
    myColorLabel.textContent = colorName(online.myColor);
    boardFlipped = online.myColor === "b";
    startGame(false);
    notice("Nova partida iniciada — as cores foram trocadas.");
}

function onNewGameClick() {
    if (mode !== "online") return startGame(true);
    if (!online.connected) return notice("O oponente está desconectado.");

    send({ type: "rematch-request" });
    notice("Pedido de nova partida enviado ao oponente.");
}

function onUndoClick() {
    if (mode !== "online") return undoMove();
    if (!online.connected) return notice("O oponente está desconectado.");
    if (pendingPromotion || undoStack.length === 0) return;

    const last = moveHistory[moveHistory.length - 1];

    if (!last || last.color !== online.myColor) {
        return notice("Você só pode desfazer o seu próprio último lance.");
    }

    send({ type: "undo-request" });
    notice("Pedido para desfazer enviado ao oponente.");
}

function onDrawClick() {
    if (mode !== "online") return offerDraw();
    if (gameOver) return;
    if (!online.connected) return notice("O oponente está desconectado.");

    send({ type: "draw-request" });
    notice("Proposta de empate enviada.");
}

function onResignClick() {
    if (mode !== "online") return resignGame();
    if (gameOver) return;

    if (!confirm("Tem certeza que deseja desistir?")) return;

    applyResign(online.myColor);
    send({ type: "resign", color: online.myColor });
}

function onLeaveClick() {
    const text = mode === "online"
        ? "Sair da partida online? Seu oponente será desconectado."
        : "Voltar ao menu? O progresso atual será perdido.";

    if (confirm(text)) backToMenu();
}

/* ---------- Mensagens recebidas ---------- */

function handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    online.lastSeen = Date.now();

    switch (msg.type) {
        case "ping":
            break;

        case "sync-request":
            send({ type: "sync", state: getState() });
            break;

        case "sync":
            applySync(msg.state);
            break;

        case "start":
            online.connected = true;
            online.myColor = msg.color;
            enterOnlineGame();
            break;

        case "full":
            resetOnline();
            resetLobbyUI();
            setLobbyStatus("Essa sala já está cheia.", true);
            break;

        case "state":
            pushUndoSnapshot();
            loadState(msg.state);
            break;

        case "draw-request":
            if (gameOver) break;
            showModal("Seu oponente propôs empate. Você aceita?", [
                { label: "Aceitar", onClick: () => { applyDraw(); send({ type: "draw-accept" }); } },
                { label: "Recusar", secondary: true, onClick: () => send({ type: "draw-deny" }) }
            ]);
            break;

        case "draw-accept":
            applyDraw();
            break;

        case "draw-deny":
            notice("O oponente recusou o empate.");
            break;

        case "resign":
            applyResign(msg.color);
            break;

        case "undo-request":
            showModal("Seu oponente quer desfazer o último lance. Você aceita?", [
                {
                    label: "Aceitar",
                    onClick: () => {
                        const last = moveHistory[moveHistory.length - 1];
                        const valid = !pendingPromotion && undoStack.length > 0 &&
                            last && last.color === opposite(online.myColor);

                        if (!valid) {
                            send({ type: "undo-deny" });
                            return;
                        }

                        undoMove();
                        send({ type: "undo-accept", state: getState() });
                    }
                },
                { label: "Recusar", secondary: true, onClick: () => send({ type: "undo-deny" }) }
            ]);
            break;

        case "undo-accept":
            undoStack.pop();
            loadState(msg.state);
            notice("Lance desfeito.");
            break;

        case "undo-deny":
            notice("O pedido para desfazer não foi aceito.");
            break;

        case "rematch-request":
            showModal("Seu oponente quer começar uma nova partida (com as cores trocadas). Você aceita?", [
                { label: "Aceitar", onClick: () => { send({ type: "rematch-accept" }); startRematch(); } },
                { label: "Recusar", secondary: true, onClick: () => send({ type: "rematch-deny" }) }
            ]);
            break;

        case "rematch-accept":
            startRematch();
            break;

        case "rematch-deny":
            notice("O oponente recusou a nova partida.");
            break;
    }
}

/* ---------- Eventos ---------- */

btnLocal.addEventListener("click", startLocal);
btnOnline.addEventListener("click", openLobby);
lobbyBackBtn.addEventListener("click", backToMenu);
createRoomBtn.addEventListener("click", () => createRoom());
joinRoomBtn.addEventListener("click", joinRoom);
roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
roomCodeInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinRoom();
});
copyCodeBtn.addEventListener("click", () => copyText(online.code || "", copyCodeBtn));
if (navigator.share) copyLinkBtn.textContent = "Compartilhar link";

copyLinkBtn.addEventListener("click", async () => {
    const base = location.href.split("?")[0].split("#")[0];
    const url = `${base}?sala=${online.code}`;

    if (navigator.share) {
        try {
            await navigator.share({ title: "Xadrez online", text: `Entre na minha sala de xadrez! Código: ${online.code}`, url });
            return;
        } catch (e) {
            if (e && e.name === "AbortError") return;
        }
    }

    copyText(url, copyLinkBtn);
});

newGameButton.addEventListener("click", onNewGameClick);
flipButton.addEventListener("click", toggleFlip);
drawButton.addEventListener("click", onDrawClick);
resignButton.addEventListener("click", onResignClick);
backToMenuBtn.addEventListener("click", onLeaveClick);

window.addEventListener("beforeunload", resetOnline);

/* ---------- Início ---------- */

startGame(false);
showScreen("menu");

// Link de convite: ?sala=CODIGO entra direto na sala
const inviteCode = new URLSearchParams(location.search).get("sala");

if (inviteCode) {
    openLobby();
    roomCodeInput.value = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    joinRoom();
}
