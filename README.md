# Face Recognition Component

一个基于 Vue 3、TypeScript、Vite 和 `face-api.js` 的人脸活体验证组件。

组件会调用浏览器摄像头，按顺序检测：

1. 左右摇头
2. 张嘴
3. 眨眼

检测通过后触发 `success` 事件。

## 快速开始

```bash
npm install
npm run dev
```

`npm install` 会自动执行 `npm run models`，把 `face-api.js` 需要的模型文件下载到 `public/models`。

如果模型下载失败，可以重新执行：

```bash
npm run models
```

## 使用组件

```vue
<template>
  <FaceRecognition @success="handleSuccess" @error="handleError" />
</template>

<script setup lang="ts">
import FaceRecognition from "./components/FaceRecognition.vue"
import type {
  FaceRecognitionError,
  FaceRecognitionResult
} from "./components/faceRecognitionTypes"

function handleSuccess(result: FaceRecognitionResult): void {
  console.log("验证通过", result.completedActions)
}

function handleError(error: FaceRecognitionError): void {
  console.error(error.message)
}
</script>
```

## Props

- `modelUrl`：模型目录，默认 `/models`。
- `width`：摄像头画面宽度，默认 `320`。
- `height`：摄像头画面高度，默认 `320`。
- `autoStart`：是否挂载后自动开始，默认 `true`。
- `detectInterval`：检测间隔，默认 `500` 毫秒。
- `inputSize`：人脸检测输入尺寸，默认 `160`。
- `scoreThreshold`：人脸检测置信度阈值，默认 `0.3`。
- `minEyeDistance`：距离摄像头过远提示阈值，默认 `50`。
- `maxEyeDistance`：距离摄像头过近提示阈值，默认 `90`。
- `headShakeRatio`：摇头动作幅度阈值，默认 `0.18`。
- `neutralExpressionThreshold`：表情变化辅助摇头判断阈值，默认 `0.99`。
- `blinkEyeAspectRatio`：眨眼阈值，默认 `0.2`。
- `mouthOpenRatio`：张嘴阈值，默认 `0.35`。
- `cameraFacingMode`：摄像头方向，默认 `user`。
- `labels`：自定义文案，支持覆盖默认提示。

## Events

- `ready`：模型与摄像头准备完成。
- `started`：开始检测。
- `stopped`：停止检测或摄像头。
- `action`：单个动作检测完成。
- `success`：所有动作检测完成。
- `error`：摄像头、模型或浏览器能力异常。

## 暴露方法

通过 `ref` 可以调用：

- `start()`：开始检测。
- `stop()`：停止检测并关闭摄像头。
- `reset()`：重置检测状态。

## 注意事项

- 摄像头能力要求页面运行在 `https://` 或 `localhost`。
- 模型文件必须存在于 `public/models`，否则组件会提示模型加载失败。
- 该组件只做前端活体动作检测，不等同于身份认证；真实身份认证需要结合后端人脸比对、风控和审计链路。
