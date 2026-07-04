// 人脸识别动作常量集中维护，避免组件内部散落魔法字符串。
// 组件内部、事件返回值、动作顺序都复用这里的值，后续新增动作时也从这里扩展。
export const FACE_RECOGNITION_ACTION = {
  // 左右摇头：通过鼻尖横向移动或表情变化判断。
  HEAD_SHAKE: "headShake",
  // 张嘴：通过嘴部关键点的高度 / 宽度比例判断。
  MOUTH_OPEN: "mouthOpen",
  // 眨眼：通过双眼纵横比变小判断。
  BLINK: "blink"
} as const

// 从 FACE_RECOGNITION_ACTION 自动推导联合类型，避免手写字符串联合类型后忘记同步。
export type FaceRecognitionAction =
  (typeof FACE_RECOGNITION_ACTION)[keyof typeof FACE_RECOGNITION_ACTION]

// 活体验证动作按该顺序依次完成：摇头 -> 张嘴 -> 眨眼。
// FaceRecognition.vue 会根据该数组找到第一个未完成动作，并显示对应提示。
export const FACE_RECOGNITION_ACTION_SEQUENCE: readonly FaceRecognitionAction[] = [
  FACE_RECOGNITION_ACTION.HEAD_SHAKE,
  FACE_RECOGNITION_ACTION.MOUTH_OPEN,
  FACE_RECOGNITION_ACTION.BLINK
]

// 组件对外抛出的错误码，便于业务侧按类型处理失败原因。
// 错误码使用固定常量，而不是直接依赖浏览器异常名称，能降低不同浏览器差异。
export const FACE_RECOGNITION_ERROR_CODE = {
  // 当前环境没有摄像头 API，常见于非 HTTPS 的手机局域网访问。
  MEDIA_UNSUPPORTED: "MEDIA_UNSUPPORTED",
  // 用户拒绝授权摄像头权限。
  CAMERA_DENIED: "CAMERA_DENIED",
  // 浏览器没有找到可用摄像头设备。
  CAMERA_NOT_FOUND: "CAMERA_NOT_FOUND",
  // 摄像头启动失败，可能是权限、协议、设备占用等原因。
  CAMERA_FAILED: "CAMERA_FAILED",
  // face-api.js 模型加载失败，通常需要检查 public/models 文件是否完整。
  MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED"
} as const

// 从 FACE_RECOGNITION_ERROR_CODE 自动推导错误码类型，保证 code 只能取上方常量值。
export type FaceRecognitionErrorCode =
  (typeof FACE_RECOGNITION_ERROR_CODE)[keyof typeof FACE_RECOGNITION_ERROR_CODE]

// 统一的错误结构，originalError 保留浏览器或模型层的原始异常。
export interface FaceRecognitionError {
  // 业务可根据 code 做不同提示或上报分类。
  code: FaceRecognitionErrorCode
  // 直接展示给用户看的错误文案。
  message: string
  // 原始异常不直接展示，但保留给调试或日志上报使用。
  originalError?: unknown
}

// success 事件返回的识别结果。
export interface FaceRecognitionResult {
  // 已完成动作列表，当前成功时会返回完整动作序列。
  completedActions: FaceRecognitionAction[]
}

// 组件内所有可替换文案，调用方可通过 labels 覆盖其中一部分。
export interface FaceRecognitionLabels {
  // 模型加载和摄像头启动期间展示。
  loading: string
  // 初始准备状态展示。
  ready: string
  // 当前画面未检测到人脸时展示。
  noFace: string
  // 人脸太远时展示。
  moveCloser: string
  // 人脸太近时展示。
  moveAway: string
  // 当前动作要求：左右摇头。
  headShake: string
  // 当前动作要求：张嘴。
  mouthOpen: string
  // 当前动作要求：眨眼。
  blink: string
  // 摇头动作完成后的提示。
  headShakeDone: string
  // 张嘴动作完成后的提示。
  mouthOpenDone: string
  // 眨眼动作完成后的提示。
  blinkDone: string
  // 全部动作通过后的提示。
  success: string
  // 当前浏览器或访问环境不支持摄像头 API。
  mediaUnsupported: string
  // 用户拒绝摄像头权限。
  cameraDenied: string
  // 没有找到摄像头设备。
  cameraNotFound: string
  // 摄像头打开失败的兜底提示。
  cameraFailed: string
  // 模型加载失败的提示。
  modelLoadFailed: string
}

// face-api.js 返回的关键点坐标只需要 x/y 两个维度。
export interface LandmarkPoint {
  // 横向坐标，随摄像头画面宽度变化。
  x: number
  // 纵向坐标，随摄像头画面高度变化。
  y: number
}

// 从 face-api.js landmarks 中抽取活体检测需要的关键部位。
export interface FaceLandmarksForLiveness {
  // 左眼 6 个关键点，用于计算左眼纵横比。
  getLeftEye: () => LandmarkPoint[]
  // 右眼 6 个关键点，用于计算右眼纵横比。
  getRightEye: () => LandmarkPoint[]
  // 嘴部关键点，用于计算张嘴高度和嘴宽比例。
  getMouth: () => LandmarkPoint[]
  // 鼻子关键点，用于追踪鼻尖横向位移判断摇头。
  getNose: () => LandmarkPoint[]
}

// 当前只使用 neutral 表情值辅助判断摇头动作是否发生。
export interface FaceExpressionsForLiveness {
  // neutral 越低，说明当前表情越偏离中性，可辅助判断用户正在做动作。
  neutral: number
}
