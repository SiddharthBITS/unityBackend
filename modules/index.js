"use strict";
var GameConfig = {
    WIN_SCORE: 30,
    DRAW_SCORE: 15,
    LOSE_SCORE: 5,
    TIME_LIMIT_TIMED: 10,
    TIME_LIMIT_CLASSIC: 0,
    TICK_RATE: 10,
};
var GameMode = {
    CLASSIC: "classic",
    TIMED: "timed"
};
var OpCode = {
    START_GAME: 1,
    MOVE: 2,
    UPDATE: 3,
    DONE: 4,
    REJECTED: 5
};
function updateLeaderboard(nk, userId, matchResult) {
    try {
        var account = nk.accountGetId(userId);
        var username = account.user.username;
        var objects = nk.storageRead([{ collection: "stats", key: "profile", userId: userId }]);
        var stats = { gamesPlayed: 0, wins: 0, losses: 0, draws: 0, currentStreak: 0, longestStreak: 0 };
        var score = 5;
        if (objects.length > 0) {
            stats = objects[0].value;
        }
        stats.gamesPlayed++;
        if (matchResult === "win") {
            stats.wins++;
            stats.currentStreak++;
            if (stats.currentStreak > stats.longestStreak) {
                stats.longestStreak = stats.currentStreak;
            }
            score = GameConfig.WIN_SCORE;
        }
        else if (matchResult === "loss") {
            stats.losses++;
            stats.currentStreak = 0;
            score = GameConfig.LOSE_SCORE;
        }
        else {
            stats.draws++;
            stats.currentStreak = 0;
            score = GameConfig.DRAW_SCORE;
        }
        var winRate = stats.gamesPlayed > 0 ? ((stats.wins / stats.gamesPlayed) * 100).toFixed(1) : "0";
        var metadata = {
            winRate: winRate + "%",
            highestStreak: stats.longestStreak
        };
        nk.leaderboardRecordWrite('tictactoe_leaderboard', userId, username, score, undefined, metadata);
        nk.storageWrite([{
                collection: "stats",
                key: "profile",
                userId: userId,
                value: stats,
                permissionRead: 2,
                permissionWrite: 0
            }]);
    }
    catch (error) {
    }
}
function checkWin(board) {
    var lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var a = line[0], b = line[1], c = line[2];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    var draw = true;
    for (var j = 0; j < board.length; j++) {
        if (board[j] === null) {
            draw = false;
            break;
        }
    }
    return draw ? "draw" : null;
}
function matchInit(ctx, logger, nk, params) {
    var mode = params['mode'] || GameMode.CLASSIC;
    var initialTicks = (mode === GameMode.TIMED) ? GameConfig.TIME_LIMIT_TIMED * GameConfig.TICK_RATE : -1;
    return {
        state: {
            board: [null, null, null, null, null, null, null, null, null],
            marks: {},
            presences: {},
            turn: "",
            winner: null,
            mode: mode,
            deadlineTicks: initialTicks
        },
        tickRate: GameConfig.TICK_RATE,
        label: JSON.stringify({ mode: mode })
    };
}
function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    if (Object.keys(state.presences).length >= 2) {
        return { state: state, accept: false, rejectMessage: "Match full" };
    }
    return { state: state, accept: true };
}
function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
    for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        state.presences[p.userId] = p;
        if (Object.keys(state.marks).length === 0) {
            state.marks[p.userId] = "X";
            state.turn = p.userId;
        }
        else if (!state.marks[p.userId]) {
            state.marks[p.userId] = "O";
        }
    }
    if (Object.keys(state.presences).length === 2 && state.turn !== "") {
        dispatcher.broadcastMessage(OpCode.START_GAME, JSON.stringify({
            marks: state.marks,
            turn: state.turn,
            mode: state.mode
        }));
        if (state.mode === GameMode.TIMED) {
            state.deadlineTicks = tick + (GameConfig.TIME_LIMIT_TIMED * GameConfig.TICK_RATE);
            dispatcher.broadcastMessage(OpCode.UPDATE, JSON.stringify({
                deadlineTicks: state.deadlineTicks,
                currentTick: tick
            }));
        }
    }
    return { state: state };
}
function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
    if (state.winner)
        return { state: state };
    if (state.mode === GameMode.TIMED && state.turn !== "" && tick >= state.deadlineTicks) {
        var keys = Object.keys(state.marks);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] !== state.turn) {
                state.winner = keys[i];
                break;
            }
        }
        if (!state.winner)
            state.winner = "draw";
        dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify({ winner: state.winner, reason: "timeout" }));
        return { state: state };
    }
    for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.opCode === OpCode.MOVE) {
            if (m.sender.userId !== state.turn)
                continue;
            var data = JSON.parse(nk.binaryToString(m.data));
            var index = data.index;
            if (state.board[index] === null) {
                state.board[index] = state.marks[m.sender.userId];
                state.index = index;
                var winStatus = checkWin(state.board);
                if (winStatus) {
                    state.winner = (winStatus === "draw") ? "draw" : m.sender.userId;
                    dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify({ board: state.board, winner: state.winner, lastMove: index }));
                    if (state.winner !== "draw") {
                        var keys = Object.keys(state.presences);
                        for (var j = 0; j < keys.length; j++) {
                            var matchResult = (state.winner === "draw" ? "draw" : (keys[j] === state.winner) ? "win" : "loss");
                            updateLeaderboard(nk, keys[j], matchResult);
                        }
                    }
                }
                else {
                    var keys = Object.keys(state.marks);
                    for (var k = 0; k < keys.length; k++) {
                        if (keys[k] !== m.sender.userId) {
                            state.turn = keys[k];
                            break;
                        }
                    }
                    if (state.mode === GameMode.TIMED) {
                        state.deadlineTicks = tick + (GameConfig.TIME_LIMIT_TIMED * GameConfig.TICK_RATE);
                    }
                    dispatcher.broadcastMessage(OpCode.UPDATE, JSON.stringify({
                        board: state.board,
                        turn: state.turn,
                        lastMove: index,
                        deadlineTicks: state.deadlineTicks,
                        currentTick: tick,
                        mode: state.mode
                    }));
                }
                break;
            }
        }
    }
    return { state: state };
}
function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
    if (state.winner) {
        for (var i = 0; i < presences.length; i++) {
            delete state.presences[presences[i].userId];
        }
        return { state: state };
    }
    for (var i = 0; i < presences.length; i++) {
        var leaverId = presences[i].userId;
        updateLeaderboard(nk, leaverId, "loss");
        delete state.presences[leaverId];
    }
    var remainingPlayerIds = Object.keys(state.presences);
    if (remainingPlayerIds.length === 1 && !state.winner) {
        var remainingPlayerId = remainingPlayerIds[0];
        state.winner = remainingPlayerId;
        updateLeaderboard(nk, remainingPlayerId, "win");
        dispatcher.broadcastMessage(OpCode.DONE, JSON.stringify({
            winner: state.winner,
            reason: "player_left"
        }));
    }
    else if (remainingPlayerIds.length === 0 && !state.winner) {
        state.winner = "draw";
    }
    return { state: state };
}
function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state: state };
}
function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
    return { state: state, data: data };
}
var TicTacToeMatchHandler = {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLoop: matchLoop,
    matchLeave: matchLeave,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
};
function matchmakerMatched(context, logger, nk, matches) {
    logger.info("Match found!");
    var mode = (matches[0].properties && matches[0].properties['mode']) || GameMode.CLASSIC;
    return nk.matchCreate("tictactoe_logic", { mode: mode });
}
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Initializing Unit TicTacToe Module...");
    initializer.registerMatch("tictactoe_logic", TicTacToeMatchHandler);
    initializer.registerMatchmakerMatched(matchmakerMatched);
    nk.leaderboardCreate('tictactoe_leaderboard', true, "descending", "increment", '0 0 * * *');
    logger.info("Module Loaded Successfully!");
}
globalThis.InitModule = InitModule;
