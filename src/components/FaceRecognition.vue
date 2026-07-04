<template>
  <!--
    组件根节点只负责承载人脸检测 UI。
    外部页面可以像普通 Vue 组件一样放入任意布局中。
  -->
  <section class="face-recognition">
    <!-- 摄像头画面与识别提示统一放在圆形容器内，便于外部复用组件。 -->
    <div class="face-recognition__camera" :style="cameraStyle">
      <!-- visibleHint 会在 loading 时隐藏，避免加载文案和动作提示同时出现。 -->
      <p v-if="visibleHint" class="face-recognition__hint">{{ visibleHint }}</p>
      <!--
        video 是摄像头画面的真实承载节点。
        autoplay/muted/playsinline 对移动端很重要，能减少自动播放和全屏播放限制。
      -->
      <video ref="videoRef" class="face-recognition__video" :class="{ 'face-recognition__video--success': isSuccess }"
        :width="width" :height="height" autoplay muted playsinline />
      <!-- 模型加载或摄像头启动期间显示遮罩，避免用户误以为正在识别动作。 -->
      <div v-if="loading" class="face-recognition__loading">
        <span class="face-recognition__spinner" />
        <span>{{ mergedLabels.loading }}</span>
      </div>
    </div>

    <!-- actionText 用来展示刚完成的动作，例如“摇头完成”。 -->
    <p v-if="actionText" class="face-recognition__action">{{ actionText }}</p>
    <!-- errorMessage 来自 normalizeError，已经是适合用户阅读的中文文案。 -->
    <p v-if="errorMessage" class="face-recognition__error">{{ errorMessage }}</p>
  </section>
</template>

<script setup lang="ts">
// Vue 组合式 API：用于声明响应式状态、生命周期和计算属性。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue"
// face-api.js 提供人脸检测、关键点识别和表情识别模型。
import * as faceapi from "face-api.js"
// 组件内复用的动作常量、错误码和类型都集中在类型文件里。
import {
  FACE_RECOGNITION_ACTION,
  FACE_RECOGNITION_ACTION_SEQUENCE,
  FACE_RECOGNITION_ERROR_CODE,
  type FaceExpressionsForLiveness,
  type FaceLandmarksForLiveness,
  type FaceRecognitionAction,
  type FaceRecognitionError,
  type FaceRecognitionLabels,
  type FaceRecognitionResult,
  type LandmarkPoint
} from "./faceRecognitionTypes"

// -----------------------------
// 组件入参和默认配置
// -----------------------------

// 组件入参集中定义，调用方可调整模型地址、识别阈值和展示文案。
interface FaceRecognitionProps {
  // face-api.js 模型所在目录，默认指向 public/models 暴露出来的 /models。
  modelUrl?: string
  // 摄像头区域的设计宽度，CSS 会在小屏下自动缩小。
  width?: number
  // 摄像头区域的设计高度，会和 width 一起计算响应式宽高比。
  height?: number
  // 是否在组件挂载后自动开始检测。
  autoStart?: boolean
  // 每隔多少毫秒检测一次画面，越小越灵敏但越消耗性能。
  detectInterval?: number
  // tiny face detector 输入尺寸，越大越精确但越慢。
  inputSize?: number
  // 人脸检测置信度阈值，越低越容易检测到人脸但误判风险更高。
  scoreThreshold?: number
  // 双眼距离低于该值时认为人脸太远。
  minEyeDistance?: number
  // 双眼距离高于该值时认为人脸太近。
  maxEyeDistance?: number
  // 鼻尖相对双眼中心的横向偏移超过该比例时认为摇头通过。
  headShakeRatio?: number
  // neutral 表情低于该阈值时，辅助认为用户表情发生变化。
  neutralExpressionThreshold?: number
  // 双眼平均纵横比低于该值时认为眨眼通过。
  blinkEyeAspectRatio?: number
  // 嘴部高度 / 嘴部宽度超过该值时认为张嘴通过。
  mouthOpenRatio?: number
  // 摄像头方向，user 通常表示前置摄像头。
  cameraFacingMode?: VideoFacingModeEnum
  // 允许业务侧覆盖部分文案，不传的字段继续使用 DEFAULT_LABELS。
  labels?: Partial<FaceRecognitionLabels>
}

// 默认文案既用于 UI 展示，也作为错误归一化时的兜底提示。
const DEFAULT_LABELS: FaceRecognitionLabels = {
  loading: "模型加载中...",
  ready: "请正对摄像头",
  noFace: "没有检测到人脸",
  moveCloser: "请靠近摄像头",
  moveAway: "请远离摄像头",
  headShake: "请左右摇头",
  mouthOpen: "请张嘴",
  blink: "请眨眼",
  headShakeDone: "摇头完成",
  mouthOpenDone: "张嘴完成",
  blinkDone: "眨眼完成",
  success: "通过",
  mediaUnsupported: "当前浏览器不支持摄像头能力",
  cameraDenied: "请允许摄像头权限",
  cameraNotFound: "未找到摄像头设备",
  cameraFailed: "无法访问摄像头，请确认是否在 HTTPS 或 localhost 环境下使用",
  modelLoadFailed: "模型加载失败，请检查 public/models 是否存在"
}

// 模型按 modelUrl 缓存，避免同一页面重复加载 face-api.js 模型文件。
const MODEL_CACHE = new Map<string, Promise<void>>()
// 以下阈值是活体检测的默认参数，支持通过 props 按业务场景微调。
// 摇头采样窗口长度，窗口越长越稳定，但动作完成反馈会略慢。
const HEAD_SHAKE_SAMPLE_LIMIT = 12
// 眨眼采样窗口长度，用于记录睁眼时的动态基线。
const BLINK_SAMPLE_LIMIT = 5
// 当前默认每次定时器触发都检测；保留常量是为了以后按性能需要恢复跳帧。
const DETECTION_FRAME_SKIP = 1
// 最小检测间隔，防止外部传入过小 detectInterval 导致 CPU 占用过高。
const MIN_DETECT_INTERVAL = 80
// 默认检测尺寸优先保证手机端速度。
const FACE_DETECTOR_DEFAULT_INPUT_SIZE = 160
// 默认置信度较低，适合移动端光线和角度变化较大的场景。
const FACE_DETECTOR_DEFAULT_SCORE = 0.3
// 双眼距离范围用于约束人脸在圆形区域中的合适大小。
const CAMERA_DISTANCE_DEFAULT_MIN = 50
const CAMERA_DISTANCE_DEFAULT_MAX = 90
// 摇头默认阈值，数值越小越容易通过；这里使用鼻尖相对眼睛中心的偏移比例。
const HEAD_SHAKE_DEFAULT_RATIO = 0.22
// 表情辅助默认关闭，避免静止人脸因为表情分数波动导致摇头误通过。
const NEUTRAL_EXPRESSION_DEFAULT_THRESHOLD = 0
// 眨眼默认阈值，已针对手机端提高灵敏度。
const BLINK_DEFAULT_RATIO = 0.28
// 当前眼睛比例低于睁眼基线的该比例时，也认为发生眨眼。
const BLINK_DYNAMIC_DROP_RATIO = 0.96
// 动态眨眼判断要求至少下降该绝对值，避免轻微关键点抖动误触发。
const BLINK_DYNAMIC_DROP_MIN = 0.012
// 张嘴默认阈值，数值越小越容易通过。
const MOUTH_OPEN_DEFAULT_RATIO = 0.35

// withDefaults 给所有可选 props 提供运行时默认值，调用方只传需要覆盖的字段即可。
const props = withDefaults(defineProps<FaceRecognitionProps>(), {
  modelUrl: "/models",
  width: 320,
  height: 320,
  autoStart: true,
  detectInterval: 160,
  inputSize: FACE_DETECTOR_DEFAULT_INPUT_SIZE,
  scoreThreshold: FACE_DETECTOR_DEFAULT_SCORE,
  minEyeDistance: CAMERA_DISTANCE_DEFAULT_MIN,
  maxEyeDistance: CAMERA_DISTANCE_DEFAULT_MAX,
  headShakeRatio: HEAD_SHAKE_DEFAULT_RATIO,
  neutralExpressionThreshold: NEUTRAL_EXPRESSION_DEFAULT_THRESHOLD,
  blinkEyeAspectRatio: BLINK_DEFAULT_RATIO,
  mouthOpenRatio: MOUTH_OPEN_DEFAULT_RATIO,
  cameraFacingMode: "user",
  labels: () => ({})
})

// -----------------------------
// 事件、状态和计算属性
// -----------------------------

// 对外事件保持类型约束，业务侧可监听状态变化、动作完成和错误。
const emit = defineEmits<{
  // 模型和摄像头准备完成，可以开始识别动作。
  ready: []
  // start 流程已经成功进入检测循环。
  started: []
  // 摄像头或检测循环已停止。
  stopped: []
  // 单个动作完成时触发，携带动作类型和展示文案。
  action: [{ action: FaceRecognitionAction; label: string }]
  // 三个动作全部完成时触发。
  success: [FaceRecognitionResult]
  // 启动或检测过程中出现可归一化错误时触发。
  error: [FaceRecognitionError]
}>()

// 运行时状态：摄像头流、检测计时器和 UI 提示都在组件内部维护。
// video DOM 引用，摄像头 MediaStream 会绑定到该节点。
const videoRef = ref<HTMLVideoElement | null>(null)
// loading 表示模型或摄像头启动中，用于显示遮罩。
const loading = ref(false)
// 顶部提示文案，表示当前希望用户做什么。
const hintText = ref(DEFAULT_LABELS.ready)
// 动作完成文案，显示最近通过的动作。
const actionText = ref("")
// 错误文案，非空时显示在组件底部。
const errorMessage = ref("")
// 全部动作通过后为 true，用于停止继续检测和切换成功样式。
const isSuccess = ref(false)
// 检测帧计数，配合 DETECTION_FRAME_SKIP 控制是否跳帧。
const frameCount = ref(0)
// 防止上一次异步检测未结束时又开始下一次检测。
const detectingFrame = ref(false)
// 当前摄像头流，stopCamera 时需要逐个停止 tracks。
const mediaStream = ref<MediaStream | null>(null)
// setInterval 返回值，stopDetection 时清理。
const detectTimer = ref<number | null>(null)
// 记录最近一段时间鼻尖相对双眼中心的偏移，用于判断真实摇头。
const headShakeSamples = ref<number[]>([])
// 记录最近一段时间双眼平均纵横比，用于为眨眼建立动态睁眼基线。
const blinkEyeRatioSamples = ref<number[]>([])
// 分别记录单眼纵横比，避免一只眼变化明显但被平均值稀释。
const leftBlinkEyeRatioSamples = ref<number[]>([])
const rightBlinkEyeRatioSamples = ref<number[]>([])

// 每个动作单独记录完成状态，顺序由 FACE_RECOGNITION_ACTION_SEQUENCE 决定。
const completedActions = reactive<Record<FaceRecognitionAction, boolean>>({
  [FACE_RECOGNITION_ACTION.HEAD_SHAKE]: false,
  [FACE_RECOGNITION_ACTION.MOUTH_OPEN]: false,
  [FACE_RECOGNITION_ACTION.BLINK]: false
})

// 合并默认文案和外部文案，外部只需要传想覆盖的字段。
const mergedLabels = computed<FaceRecognitionLabels>(() => ({
  ...DEFAULT_LABELS,
  ...props.labels
}))

// 摄像头容器样式由 props 驱动，小屏下 width 使用 CSS min 自动缩放。
const cameraStyle = computed(() => ({
  width: `min(${props.width}px, 100%)`,
  aspectRatio: `${props.width} / ${props.height}`
}))

// 加载中隐藏普通提示，防止“模型加载中”和“请摇头”等提示同时出现。
const visibleHint = computed(() => {
  if (loading.value) {
    return ""
  }

  return hintText.value
})

// -----------------------------
// 生命周期和外部控制
// -----------------------------

// autoStart 为 true 时组件挂载后自动加载模型并打开摄像头。
onMounted(() => {
  if (props.autoStart) {
    // start 是异步函数，这里不阻塞 Vue 挂载流程。
    void start()
  }
})

// 组件销毁前必须释放摄像头，否则浏览器仍会显示摄像头占用。
onBeforeUnmount(() => {
  stop()
})

// 支持外部动态切换 autoStart，例如父组件控制是否自动开启识别。
watch(
  () => props.autoStart,
  (autoStart) => {
    if (autoStart) {
      // 外部从 false 切到 true 时重新走启动流程。
      void start()
      return
    }

    // 外部从 true 切到 false 时停止摄像头和检测循环。
    stop()
  }
)

// -----------------------------
// 启动、停止和状态重置
// -----------------------------

// 启动流程：重置状态 -> 校验能力 -> 加载模型 -> 打开摄像头 -> 开始检测。
async function start(): Promise<void> {
  // 防止重复点击或重复自动启动导致多条摄像头流同时存在。
  if (loading.value || mediaStream.value) {
    return
  }

  // 每次开始都先恢复到初始检测状态，避免沿用上一次动作结果。
  resetState()
  loading.value = true

  try {
    // 先检查浏览器摄像头 API，再加载模型和打开摄像头。
    assertMediaSupport()
    await loadModels(props.modelUrl)
    await startCamera()
    startDetection()
    // 准备完成后直接提示第一个动作。
    hintText.value = mergedLabels.value.headShake
    emit("ready")
    emit("started")
  } catch (error) {
    // 任何启动异常都统一转换成 FaceRecognitionError 再对外抛出。
    const normalizedError = normalizeError(error)
    errorMessage.value = normalizedError.message
    emit("error", normalizedError)
    stop()
  } finally {
    loading.value = false
  }
}

// stop 只负责释放运行资源，不清空识别结果，方便调用方保留当前提示。
function stop(): void {
  // 先停止检测循环，再释放摄像头，避免释放后仍有定时器访问 video。
  stopDetection()
  stopCamera()
  emit("stopped")
}

// reset 用于重新检测，会同时释放资源并恢复初始 UI 状态。
function reset(): void {
  // reset 是“完全重置”，因此会先停止当前所有运行资源。
  stop()
  resetState()
}

// 将所有动作和提示恢复到新一轮检测开始前的状态。
function resetState(): void {
  // 三个动作状态全部清空。
  completedActions[FACE_RECOGNITION_ACTION.HEAD_SHAKE] = false
  completedActions[FACE_RECOGNITION_ACTION.MOUTH_OPEN] = false
  completedActions[FACE_RECOGNITION_ACTION.BLINK] = false
  // 摇头采样、帧计数和 UI 文案都恢复到初始值。
  headShakeSamples.value = []
  blinkEyeRatioSamples.value = []
  leftBlinkEyeRatioSamples.value = []
  rightBlinkEyeRatioSamples.value = []
  frameCount.value = 0
  actionText.value = ""
  errorMessage.value = ""
  isSuccess.value = false
  hintText.value = mergedLabels.value.ready
}

// -----------------------------
// 模型和摄像头资源
// -----------------------------

function assertMediaSupport(): void {
  // getUserMedia 只在安全上下文中可用：HTTPS 或 localhost。
  // 手机访问局域网 IP 时如果不是 HTTPS，这里通常会失败。
  if (!navigator.mediaDevices?.getUserMedia) {
    throw createFaceRecognitionError(
      FACE_RECOGNITION_ERROR_CODE.MEDIA_UNSUPPORTED,
      mergedLabels.value.mediaUnsupported
    )
  }
}

// 模型加载较慢且可复用，因此同一路径只保留一个加载 Promise。
async function loadModels(modelUrl: string): Promise<void> {
  // 如果同一个 modelUrl 已经加载过或正在加载，直接复用缓存中的 Promise。
  if (!MODEL_CACHE.has(modelUrl)) {
    MODEL_CACHE.set(
      modelUrl,
      Promise.all([
        // tinyFaceDetector：负责从画面中找到一张人脸。
        faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
        // faceLandmark68Net：负责输出眼睛、鼻子、嘴巴等 68 个关键点。
        faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
        // faceExpressionNet：负责输出 neutral 等表情概率，用于辅助动作判断。
        faceapi.nets.faceExpressionNet.loadFromUri(modelUrl)
      ]).then(() => undefined)
    )
  }

  // 等待模型真正可用后再继续打开摄像头和检测。
  await MODEL_CACHE.get(modelUrl)
}

// 打开摄像头前等待 video 节点就绪，并把 MediaStream 绑定到 video。
async function startCamera(): Promise<void> {
  const videoElement = videoRef.value

  if (!videoElement) {
    // 极端情况下 start 早于 video 渲染完成，等待一次 DOM 更新。
    await nextTick()
  }

  const activeVideoElement = videoRef.value

  if (!activeVideoElement) {
    // 等待后仍拿不到 video，说明组件状态异常，统一按摄像头失败处理。
    throw createFaceRecognitionError(
      FACE_RECOGNITION_ERROR_CODE.CAMERA_FAILED,
      mergedLabels.value.cameraFailed
    )
  }

  // 请求视频流，不请求音频，避免浏览器额外弹出麦克风权限。
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      // 使用组件尺寸请求摄像头画面，和 UI 容器保持一致。
      width: props.width,
      height: props.height,
      // 默认 user 即前置摄像头，适合人脸活体验证。
      facingMode: props.cameraFacingMode
    },
    audio: false
  })

  // 保存 stream 以便停止时释放设备，并绑定到 video 播放。
  mediaStream.value = stream
  activeVideoElement.srcObject = stream
  await activeVideoElement.play()
}

// -----------------------------
// 检测循环和活体流程
// -----------------------------

// 使用定时器做间隔检测，并设置最小间隔避免过高频率占用 CPU。
function startDetection(): void {
  // 开始新检测前先清理旧定时器，避免重复检测。
  stopDetection()
  const interval = Math.max(props.detectInterval, MIN_DETECT_INTERVAL)

  // 定时读取当前 video 画面做人脸检测。
  detectTimer.value = window.setInterval(() => {
    void detectCurrentFrame()
  }, interval)
}

function stopDetection(): void {
  // 没有定时器时直接返回，保证 stop 可重复调用。
  if (detectTimer.value === null) {
    return
  }

  // 清除定时器并置空，避免后续误判还在检测。
  window.clearInterval(detectTimer.value)
  detectTimer.value = null
}

function stopCamera(): void {
  // 停止所有视频轨道，真正释放摄像头占用。
  mediaStream.value?.getTracks().forEach((track) => {
    track.stop()
  })
  mediaStream.value = null

  if (videoRef.value) {
    // 清空 video 的 srcObject，避免页面上残留最后一帧。
    videoRef.value.srcObject = null
  }
}

// 当前帧默认不跳帧检测，并用 detectingFrame 防止异步检测重入。
async function detectCurrentFrame(): Promise<void> {
  const videoElement = videoRef.value

  // video 不存在、上一帧未检测完、或已经成功时，都不再开始新检测。
  if (!videoElement || detectingFrame.value || isSuccess.value) {
    return
  }

  frameCount.value += 1

  // 目前 DETECTION_FRAME_SKIP 为 1，保留该判断方便以后按性能恢复跳帧。
  if (frameCount.value % DETECTION_FRAME_SKIP !== 0) {
    return
  }

  // 标记检测中，直到 finally 才释放，确保异常时也不会卡住状态。
  detectingFrame.value = true

  try {
    // TinyFaceDetectorOptions 控制检测速度和置信度。
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: props.inputSize,
      scoreThreshold: props.scoreThreshold
    })
    // 检测单张人脸，并同时取关键点和表情结果。
    const detection = await faceapi
      .detectSingleFace(videoElement, options)
      .withFaceLandmarks()
      .withFaceExpressions()

    if (!detection) {
      // 没有人脸时只更新提示，不算错误，继续等待下一帧。
      hintText.value = mergedLabels.value.noFace
      return
    }

    // 有人脸后进入活体动作判断。
    evaluateLiveness(detection.landmarks, detection.expressions)
  } finally {
    detectingFrame.value = false
  }
}

function evaluateLiveness(
  landmarks: FaceLandmarksForLiveness,
  expressions: FaceExpressionsForLiveness
): void {
  // 双眼距离用于判断人脸与摄像头的远近，避免动作误判。
  const leftEye = landmarks.getLeftEye()
  const rightEye = landmarks.getRightEye()
  const eyeDistance = calculateDistance(leftEye[0], rightEye[3])

  if (eyeDistance < props.minEyeDistance) {
    // 人脸太远时关键点变化不明显，先引导用户靠近。
    hintText.value = mergedLabels.value.moveCloser
    return
  }

  if (eyeDistance > props.maxEyeDistance) {
    // 人脸太近时关键点可能超出画面或变形，先引导用户远离。
    hintText.value = mergedLabels.value.moveAway
    return
  }

  // 根据动作顺序找到当前应该完成的动作。
  const currentAction = getCurrentAction()

  if (!currentAction) {
    // 没有未完成动作，说明所有动作都已通过。
    completeRecognition()
    return
  }

  // 展示当前动作提示，例如“请眨眼”。
  hintText.value = getActionHint(currentAction)

  if (isActionPassed(currentAction, landmarks, expressions, eyeDistance)) {
    // 当前动作通过后更新状态，并可能进入成功流程。
    markActionPassed(currentAction)
  }
}

// -----------------------------
// 动作提示和动作判定
// -----------------------------

// 找到第一个未完成动作，确保活体验证按固定顺序推进。
function getCurrentAction(): FaceRecognitionAction | undefined {
  // find 会返回第一个未完成动作；如果全部完成则返回 undefined。
  return FACE_RECOGNITION_ACTION_SEQUENCE.find((action) => !completedActions[action])
}

function getActionHint(action: FaceRecognitionAction): string {
  // 动作和提示文案显式映射，避免在多个 if 分支中重复读取 labels。
  const actionHintMap: Record<FaceRecognitionAction, string> = {
    [FACE_RECOGNITION_ACTION.HEAD_SHAKE]: mergedLabels.value.headShake,
    [FACE_RECOGNITION_ACTION.MOUTH_OPEN]: mergedLabels.value.mouthOpen,
    [FACE_RECOGNITION_ACTION.BLINK]: mergedLabels.value.blink
  }

  return actionHintMap[action]
}

function getActionDoneLabel(action: FaceRecognitionAction): string {
  // 动作完成文案和动作提示分开维护，方便业务定制不同表达。
  const actionDoneMap: Record<FaceRecognitionAction, string> = {
    [FACE_RECOGNITION_ACTION.HEAD_SHAKE]: mergedLabels.value.headShakeDone,
    [FACE_RECOGNITION_ACTION.MOUTH_OPEN]: mergedLabels.value.mouthOpenDone,
    [FACE_RECOGNITION_ACTION.BLINK]: mergedLabels.value.blinkDone
  }

  return actionDoneMap[action]
}

function isActionPassed(
  action: FaceRecognitionAction,
  landmarks: FaceLandmarksForLiveness,
  expressions: FaceExpressionsForLiveness,
  eyeDistance: number
): boolean {
  // 根据当前动作分发到对应算法，每个动作只关心自己需要的关键点。
  if (action === FACE_RECOGNITION_ACTION.HEAD_SHAKE) {
    return isHeadShakePassed(landmarks, expressions, eyeDistance)
  }

  if (action === FACE_RECOGNITION_ACTION.MOUTH_OPEN) {
    return isMouthOpenPassed(landmarks)
  }

  return isBlinkPassed(landmarks)
}

// 摇头使用“鼻尖相对双眼中心”的横向偏移判断，减少手机整体移动造成的误判。
function isHeadShakePassed(
  landmarks: FaceLandmarksForLiveness,
  expressions: FaceExpressionsForLiveness,
  eyeDistance: number
): boolean {
  const leftEye = landmarks.getLeftEye()
  const rightEye = landmarks.getRightEye()
  const nose = landmarks.getNose()
  // nose 数组最后一个点接近鼻尖，横向移动最能体现摇头。
  const noseTip = nose[nose.length - 1]
  // 眼睛中心跟随整张脸平移，使用相对偏移可以过滤手机轻微移动。
  const eyeCenterX = (calculateAverageX(leftEye) + calculateAverageX(rightEye)) / 2
  const normalizedNoseOffset = (noseTip.x - eyeCenterX) / eyeDistance

  // 只保留最近 HEAD_SHAKE_SAMPLE_LIMIT 个相对偏移，避免旧数据影响当前判断。
  headShakeSamples.value = [...headShakeSamples.value, normalizedNoseOffset].slice(
    -HEAD_SHAKE_SAMPLE_LIMIT
  )

  // 采样未满时不通过，避免刚进入摇头阶段时因为抖动立即触发。
  if (headShakeSamples.value.length < HEAD_SHAKE_SAMPLE_LIMIT) {
    return false
  }

  // 计算采样窗口内鼻尖相对偏移的最大跨度。
  const maxX = Math.max(...headShakeSamples.value)
  const minX = Math.min(...headShakeSamples.value)
  // normalizedNoseOffset 已经除以 eyeDistance，因此这里直接和比例阈值比较。
  const landmarkMovementPassed = maxX - minX > props.headShakeRatio
  // 表情辅助默认关闭；如果外部显式调高阈值，可作为兼容旧逻辑的补充条件。
  const expressionChanged = expressions.neutral < props.neutralExpressionThreshold

  return landmarkMovementPassed || expressionChanged
}

// 张嘴通过嘴部高度和宽度比例判断，能适配不同画面距离。
function isMouthOpenPassed(landmarks: FaceLandmarksForLiveness): boolean {
  const mouth = landmarks.getMouth()
  // mouth[0] 和 mouth[6] 分别接近嘴角，用于估算嘴宽。
  const mouthWidth = calculateDistance(mouth[0], mouth[6])
  // mouth[13] 和 mouth[19] 分别位于上下嘴唇内侧，用于估算张嘴高度。
  const mouthHeight = calculateDistance(mouth[13], mouth[19])

  // 使用比例而不是绝对高度，能减少距离摄像头远近带来的影响。
  return mouthHeight / mouthWidth > props.mouthOpenRatio
}

// 眨眼使用双眼平均纵横比，比例越小说明眼睛闭合程度越高。
function isBlinkPassed(landmarks: FaceLandmarksForLiveness): boolean {
  // 分别计算左右眼，避免单侧关键点抖动导致误判。
  const leftEyeRatio = calculateEyeAspectRatio(landmarks.getLeftEye())
  const rightEyeRatio = calculateEyeAspectRatio(landmarks.getRightEye())
  // 取平均值后再判断，眨眼识别会更稳定。
  const averageEyeRatio = (leftEyeRatio + rightEyeRatio) / 2
  blinkEyeRatioSamples.value = [...blinkEyeRatioSamples.value, averageEyeRatio].slice(
    -BLINK_SAMPLE_LIMIT
  )
  leftBlinkEyeRatioSamples.value = [...leftBlinkEyeRatioSamples.value, leftEyeRatio].slice(
    -BLINK_SAMPLE_LIMIT
  )
  rightBlinkEyeRatioSamples.value = [...rightBlinkEyeRatioSamples.value, rightEyeRatio].slice(
    -BLINK_SAMPLE_LIMIT
  )

  // 固定阈值作为兜底，适合眼睛关键点比例比较标准的设备。
  const fixedThresholdPassed = averageEyeRatio < props.blinkEyeAspectRatio
  // 动态基线分别判断平均值、左眼、右眼，避免单眼变化被平均值抵消。
  const dynamicThresholdPassed =
    isEyeRatioDropped(averageEyeRatio, blinkEyeRatioSamples.value) ||
    isEyeRatioDropped(leftEyeRatio, leftBlinkEyeRatioSamples.value) ||
    isEyeRatioDropped(rightEyeRatio, rightBlinkEyeRatioSamples.value)

  return fixedThresholdPassed || dynamicThresholdPassed
}

// -----------------------------
// 完成状态和几何工具
// -----------------------------

// 单个动作完成后更新提示并通知调用方，全部完成则结束识别。
function markActionPassed(action: FaceRecognitionAction): void {
  // 标记当前动作已完成，getCurrentAction 会据此推进到下一个动作。
  completedActions[action] = true
  actionText.value = getActionDoneLabel(action)
  // 业务侧可以通过 action 事件记录用户已经完成哪个动作。
  emit("action", { action, label: actionText.value })

  const nextAction = getCurrentAction()

  if (!nextAction) {
    // 当前动作是最后一个动作时，直接进入成功流程。
    completeRecognition()
    return
  }

  // 还有下一个动作时，切换顶部提示。
  hintText.value = getActionHint(nextAction)
}

// 成功后停止检测和摄像头，防止继续占用设备资源。
function completeRecognition(): void {
  // 防止多帧检测同时命中最后一个动作后重复触发 success。
  if (isSuccess.value) {
    return
  }

  // 成功后更新 UI，停止资源，并把完整动作列表回传给父组件。
  isSuccess.value = true
  hintText.value = mergedLabels.value.success
  actionText.value = mergedLabels.value.blinkDone
  stopDetection()
  stopCamera()
  emit("success", { completedActions: [...FACE_RECOGNITION_ACTION_SEQUENCE] })
}

function calculateEyeAspectRatio(eye: LandmarkPoint[]): number {
  // 眼睛纵向距离取两组点的和，可以减少单个关键点抖动影响。
  const verticalOne = calculateDistance(eye[1], eye[5])
  const verticalTwo = calculateDistance(eye[2], eye[4])
  // 横向距离取眼角两点，作为眼睛宽度基准。
  const horizontal = calculateDistance(eye[0], eye[3])

  // EAR 公式：眼睛高度 / 眼睛宽度；闭眼时高度变小，所以结果变小。
  return (verticalOne + verticalTwo) / (2 * horizontal)
}

function isEyeRatioDropped(currentRatio: number, ratioSamples: number[]): boolean {
  // 采样不足时先不做动态判断，避免刚进入眨眼阶段就被抖动触发。
  if (ratioSamples.length < BLINK_SAMPLE_LIMIT) {
    return false
  }

  // 最近窗口的最大值近似代表睁眼状态，当前值明显低于它时认为发生闭眼动作。
  const openEyeBaseline = Math.max(...ratioSamples)

  return (
    openEyeBaseline - currentRatio >= BLINK_DYNAMIC_DROP_MIN &&
    currentRatio <= openEyeBaseline * BLINK_DYNAMIC_DROP_RATIO
  )
}

function calculateDistance(pointA: LandmarkPoint, pointB: LandmarkPoint): number {
  // 使用欧几里得距离计算两个关键点之间的直线距离。
  return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y)
}

function calculateAverageX(points: LandmarkPoint[]): number {
  // 计算一组关键点的平均横坐标，用于估算眼睛中心位置。
  return points.reduce((sum, point) => sum + point.x, 0) / points.length
}

// -----------------------------
// 错误归一化
// -----------------------------

// 将浏览器异常和内部异常统一转成组件对外的错误结构。
function normalizeError(error: unknown): FaceRecognitionError {
  if (isFaceRecognitionError(error)) {
    // 如果已经是组件内部创建的错误，直接返回避免二次包装。
    return error
  }

  if (error instanceof DOMException && error.name === "NotAllowedError") {
    // 用户拒绝权限时浏览器通常抛 NotAllowedError。
    return createFaceRecognitionError(
      FACE_RECOGNITION_ERROR_CODE.CAMERA_DENIED,
      mergedLabels.value.cameraDenied,
      error
    )
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    // 没有摄像头设备时浏览器通常抛 NotFoundError。
    return createFaceRecognitionError(
      FACE_RECOGNITION_ERROR_CODE.CAMERA_NOT_FOUND,
      mergedLabels.value.cameraNotFound,
      error
    )
  }

  // 其他异常统一按摄像头失败处理，保留原始错误方便调试。
  return createFaceRecognitionError(
    FACE_RECOGNITION_ERROR_CODE.CAMERA_FAILED,
    mergedLabels.value.cameraFailed,
    error
  )
}

function isFaceRecognitionError(error: unknown): error is FaceRecognitionError {
  // 用结构判断而不是 instanceof，因为错误对象可能跨模块或跨上下文传递。
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  )
}

function createFaceRecognitionError(
  code: FaceRecognitionError["code"],
  message: string,
  originalError?: unknown
): FaceRecognitionError {
  // 所有错误都通过该函数创建，保证对外 error 事件结构一致。
  return {
    code,
    message,
    originalError
  }
}

// 暴露给父组件的控制方法，用于手动开始、停止或重新检测。
defineExpose({
  start,
  stop,
  reset
})
</script>

<style scoped>
/* 组件根布局：以竖向排列呈现摄像头、动作结果和错误提示。 */
.face-recognition {
  display: inline-flex;
  width: 100%;
  max-width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

/* 摄像头容器保持圆形裁剪，提示层和加载层都叠加在内部。 */
.face-recognition__camera {
  position: relative;
  overflow: hidden;
  max-width: 100%;
  border-radius: 999px;
  background: #101828;
  box-shadow: 0 18px 45px rgba(16, 24, 40, 0.18);
}

/* 顶部提示条固定覆盖在摄像头容器上方，提示当前动作或距离调整。 */
.face-recognition__hint {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  margin: 0;
  padding: 12px 16px;
  color: #ffffff;
  text-align: center;
  background: rgba(0, 0, 0, 0.52);
}

/* 前置摄像头画面做镜像处理，更符合用户照镜子的交互直觉。 */
.face-recognition__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
  transition: filter 0.2s ease;
}

/* 通过后模糊画面，减少成功态继续展示人脸细节。 */
.face-recognition__video--success {
  filter: blur(10px);
}

/* 模型或摄像头启动期间用遮罩阻止用户误读识别状态。 */
.face-recognition__loading {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #ffffff;
  background: rgba(16, 24, 40, 0.82);
}

/* 加载动画使用纯 CSS 实现，避免引入额外图标资源。 */
.face-recognition__spinner {
  width: 30px;
  height: 30px;
  border: 3px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 999px;
  animation: face-recognition-spin 0.8s linear infinite;
}

/* 动作完成提示使用绿色强调，和错误提示形成视觉区分。 */
.face-recognition__action {
  margin: 0;
  color: #16a34a;
  font-weight: 700;
}

/* 错误文案限制宽度，避免长文本在小屏上撑开布局。 */
.face-recognition__error {
  max-width: 320px;
  margin: 0;
  color: #dc2626;
  text-align: center;
}

/* spinner 旋转关键帧，只改变 transform，性能开销较低。 */
@keyframes face-recognition-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
