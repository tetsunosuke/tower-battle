// Matter.js モジュールのエイリアスを設定
const { Engine, Render, Runner, Bodies, Composite, Events, Mouse, MouseConstraint, Body, Vertices } = Matter;
const OBJECT_SCALE = 0.3; // オブジェクトの最終的なスケール

// --- DOM要素の取得 ---
const gameContainer = document.getElementById('game-container');
const gameOverOverlay = document.getElementById('game-over-overlay');
const scoreElement = document.getElementById('score');
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('output_canvas'); // プレビュー用キャンバス
const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
const captureBtn = document.getElementById('capture-btn');
const rotateBtn = document.getElementById('rotate-btn');
const retryBtn = document.getElementById('retry-btn');

// --- ゲームの基本設定 ---
const screenWidth = 800;
const screenHeight = 600;

// --- Matter.js エンジンのセットアップ ---
const engine = Engine.create();
const world = engine.world;
const render = Render.create({
    element: gameContainer,
    engine: engine,
    options: { width: screenWidth, height: screenHeight, wireframes: false, background: '#f0f0f0' } // グローバルなワイヤーフレームはfalse
});
Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// --- 静的オブジェクト（地面と台座）の作成 ---
const ground = Bodies.rectangle(screenWidth / 2, screenHeight - 20, screenWidth, 40, { isStatic: true });
const pedestal = Bodies.rectangle(screenWidth / 2, screenHeight - 70, 200, 20, { isStatic: true });
Composite.add(world, [ground, pedestal]);

// --- ゲームの状態に関する変数 ---
let currentObject = null;
let isObjectFalling = false;
let isGameOver = false;
let isBoardStable = true;
let score = 0;
let lastResults = null; // MediaPipeの最新結果を保持する変数

// --- MediaPipe Selfie Segmentationのセットアップ ---
const selfieSegmentation = new SelfieSegmentation({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`});
selfieSegmentation.setOptions({ modelSelection: 1 });
selfieSegmentation.onResults(onResults);

// --- カメラのセットアップ ---
const camera = new Camera(videoElement, {
  onFrame: async () => await selfieSegmentation.send({image: videoElement}),
  width: 320,
  height: 240
});
camera.start();

// --- MediaPipe処理結果のコールバック ---
function onResults(results) {
    lastResults = results; // キャプチャ用に最新の結果を保存

    outputCtx.save();
    outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.translate(outputCanvas.width, 0);
    outputCtx.scale(-1, 1);
    outputCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.globalCompositeOperation = 'destination-in';
    outputCtx.drawImage(results.segmentationMask, 0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.restore();
}

// --- ゲームロジック ---

// キャプチャしてオブジェクトを生成する (プレビューの見た目通りバージョン)
function captureAndGenerateObject() {
    if (isGameOver || !isBoardStable || currentObject) return;

    const imageDataUrl = outputCanvas.toDataURL('image/png');
    const contour = getContour(outputCtx.getImageData(0, 0, outputCanvas.width, outputCanvas.height));
    
    if (contour.length < 3) {
        console.warn("Could not find a valid contour. Falling back to a rectangle.");
        generateObject(imageDataUrl);
        return;
    }

    const convexHull = createConvexHull(contour);
    generateObject(imageDataUrl, convexHull, { x: outputCanvas.width / 2, y: outputCanvas.height / 2 });
}

// 輪郭（Contour）を検出する
function getContour(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const points = [];
    const step = 4;
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            if (data[(y * width + x) * 4 + 3] > 128) {
                points.push({ x, y });
            }
        }
    }
    return points;
}

// 輪郭から凸包（Convex Hull）を生成する
function createConvexHull(points) {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 新しいオブジェクトを生成する (サイズ調整機能付き)

function generateObject(texture, vertices, center) {
    isBoardStable = false;
    const x = screenWidth / 2;
    const y = 150;
    let body;

    if (vertices && vertices.length >= 3) {
        // 頂点を直接スケールして物理ボディを作成
        const scaledVertices = vertices.map(v => ({ x: (v.x - center.x) * OBJECT_SCALE, y: (v.y - center.y) * OBJECT_SCALE }));
        body = Bodies.fromVertices(x, y, [scaledVertices], {
            render: {
                sprite: { texture: texture, xScale: OBJECT_SCALE, yScale: OBJECT_SCALE },
                fillStyle: 'rgba(255, 0, 0, 0.3)', // 半透明の赤で塗りつぶし
                strokeStyle: '#FF0000',   // 赤色の輪郭線
                lineWidth: 2              // 線の太さ
            },
            friction: 0.7, 
            restitution: 0.1
        });
    } else {
        // フォールバックの四角形もスケールを適用
        body = Bodies.rectangle(x, y, 80 * OBJECT_SCALE, 80 * OBJECT_SCALE, {
            render: {
                sprite: { texture: texture, xScale: OBJECT_SCALE, yScale: OBJECT_SCALE },
                fillStyle: 'rgba(255, 0, 0, 0.3)',
                strokeStyle: '#FF0000',
                lineWidth: 2
            },
            friction: 0.7, 
            restitution: 0.1
        });
    }

    currentObject = body;
    Body.setStatic(currentObject, true);
    Composite.add(world, currentObject);
    isObjectFalling = false;
}

// ボードの静止状態をチェックする
function checkBoardStability() {
    if (isGameOver) return;
    let allStopped = true;
    for (let body of Composite.allBodies(world)) {
        if (!body.isStatic && body.speed > 0.2) { 
            allStopped = false;
            break;
        }
    }
    if (allStopped) {
        isBoardStable = true;
        isObjectFalling = false;
    } else {
        setTimeout(checkBoardStability, 400);
    }
}

// --- イベントリスナーとマウス操作 ---
captureBtn.addEventListener('click', captureAndGenerateObject);
rotateBtn.addEventListener('click', () => {
    if (currentObject && !isObjectFalling && !isGameOver) Body.rotate(currentObject, -Math.PI / 6);
});
retryBtn.addEventListener('click', () => location.reload());

const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: { stiffness: 0.2, render: { visible: false } }
});
Composite.add(world, mouseConstraint);

Events.on(engine, 'beforeUpdate', () => {
    if (isGameOver) return;
    if (currentObject && !isObjectFalling) Body.setPosition(currentObject, { x: mouse.position.x, y: 300 }); // Y座標を300に変更
    updateScore();
    checkGameOver();
    updateCameraView();
});

Events.on(mouseConstraint, 'mouseup', () => {
    if (currentObject && !isObjectFalling && !isGameOver) {
        Body.setStatic(currentObject, false);
        isObjectFalling = true;
        currentObject = null;
        setTimeout(checkBoardStability, 2000);
    }
});

// --- その他の関数（スコア、ゲームオーバー、カメラ更新）---
let scoreUpdater = () => {
    let highestPoint = 0;
    for (let body of Composite.allBodies(world)) {
        if (!body.isStatic) {
            const topY = body.bounds.min.y;
            highestPoint = Math.max(highestPoint, screenHeight - topY);
        }
    }
    score = Math.floor(highestPoint);
    scoreElement.textContent = `Score: ${score}`;
};

let gameOverChecker = () => {
    if(isGameOver) return;
    for (let body of Composite.allBodies(world)) {
        if (!body.isStatic && body.position.y > screenHeight + 100) {
            endGame();
            break;
        }
    }
};

let cameraViewUpdater = () => {
    const highestY = screenHeight - score;
    if (highestY < screenHeight / 2) {
        const offsetY = (screenHeight / 2) - highestY;
        Render.lookAt(render, Composite.allBodies(world), { x: screenWidth / 2, y: screenHeight / 2 - offsetY });
    }
};

let gameEnder = () => {
    if (isGameOver) return;
    isGameOver = true;
    gameOverOverlay.style.display = 'flex';
    Runner.stop(runner);
    camera.stop();
};

const updateScore = scoreUpdater;
const checkGameOver = gameOverChecker;
const updateCameraView = cameraViewUpdater;
const endGame = gameEnder;