import React from "react"
import convertHrtime from "convert-hrtime"
import { Box } from "ink"

const maxWidth = 30
const minWidth = 10

const getLength = prop => String(prop).length

export const calcElapsedTime = startTime => {
  const elapsed = process.hrtime(startTime)

  return convertHrtime(elapsed)[`seconds`].toFixed(3)
}

export default function ProgressBar({ message, current, total }) {
  const percentage = total ? Math.round((current / total) * 100) : 0
  const terminalWidth = process.stdout.columns || 80
  const availableWidth =
    terminalWidth -
    getLength(message) -
    getLength(current) -
    getLength(total) -
    getLength(percentage) -
    11 // margins + extra characters

  const progressBarWidth = Math.max(
    minWidth,
    Math.min(maxWidth, availableWidth)
  )
  return (
    <Box flexDirection="row">
      <Box marginRight={3} width={progressBarWidth}>
        [
        <Box width={progressBarWidth - 2}>
          {`=`.repeat(((progressBarWidth - 2) * percentage) / 100)}
        </Box>
        ]
      </Box>
      <Box marginRight={1}>
        {current}/{total}
      </Box>
      <Box marginRight={1}>{`` + percentage}%</Box>
      <Box textWrap="truncate">{message}</Box>
    </Box>
  )
}
