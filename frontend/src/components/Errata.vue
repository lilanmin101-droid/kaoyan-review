<script setup lang="ts">
// 原卷印错的地方：题面按原卷保留，这里说明「原卷印作 X，应为 Y」
export type Erratum = { printed: string; correct: string; note?: string | null }
defineProps<{ list?: Erratum[] | null }>()
</script>
<template>
  <div v-if="list?.length" class="errata">
    <p v-for="(e, i) in list" :key="i"><b>勘误</b>原卷印作 <s>{{ e.printed }}</s>，应为 <em>{{ e.correct }}</em><small v-if="e.note">{{ e.note }}</small></p>
  </div>
</template>
