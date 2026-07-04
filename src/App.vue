<template>
  <main class="demo-page">
    <section class="demo-card">
      <p class="demo-eyebrow">Vue 3 + TypeScript</p>
      <h1>人脸活体验证组件</h1>
      <p class="demo-description">
        打开页面后会自动请求摄像头权限，按提示完成左右摇头、张嘴、眨眼后触发 success 事件。
      </p>

      <!-- 演示页面通过事件监听组件识别进度，并通过 ref 控制重新检测。 -->
      <FaceRecognition
        ref="faceRecognitionRef"
        :labels="labels"
        @action="handleAction"
        @success="handleSuccess"
        @error="handleError"
      />

      <div class="demo-actions">
        <button type="button" @click="restart">重新检测</button>
        <button type="button" class="demo-button-secondary" @click="stop">停止摄像头</button>
      </div>

      <p class="demo-result">{{ resultText }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue"
import FaceRecognition from "./components/FaceRecognition.vue"
import type {
  FaceRecognitionError,
  FaceRecognitionLabels,
  FaceRecognitionResult
} from "./components/faceRecognitionTypes"

// FaceRecognition 通过 defineExpose 暴露的控制方法类型。
interface FaceRecognitionExpose {
  start: () => Promise<void>
  stop: () => void
  reset: () => void
}

const faceRecognitionRef = ref<FaceRecognitionExpose | null>(null)
const resultText = ref("等待检测")

// 演示页只覆盖部分文案，其余文案继续使用组件默认值。
const labels: Partial<FaceRecognitionLabels> = {
  loading: "正在加载人脸模型...",
  headShake: "请左右摇头",
  mouthOpen: "请张嘴",
  blink: "请眨眼",
  success: "验证通过"
}

// 每完成一个动作就同步展示组件返回的动作文案。
function handleAction(payload: { label: string }): void {
  resultText.value = payload.label
}

// success 事件返回已完成动作列表，演示页将其拼接展示。
function handleSuccess(result: FaceRecognitionResult): void {
  resultText.value = `验证通过，完成动作：${result.completedActions.join("、")}`
}

// error 事件已由组件归一化，这里直接展示可读错误文案。
function handleError(error: FaceRecognitionError): void {
  resultText.value = error.message
}

// 重新检测时先清空组件状态，再重新打开摄像头和检测循环。
function restart(): void {
  faceRecognitionRef.value?.reset()
  void faceRecognitionRef.value?.start()
}

// 停止摄像头只释放设备占用，不销毁页面上的组件实例。
function stop(): void {
  faceRecognitionRef.value?.stop()
  resultText.value = "摄像头已停止"
}
</script>
