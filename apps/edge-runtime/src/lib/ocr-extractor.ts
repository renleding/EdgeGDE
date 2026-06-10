/**
 * EdgeGDE — OCR Extractor
 *
 * Routes uploaded ID image to local qwen3-vl:4b over Tailscale mesh,
 * parses structured fields from the vision model response.
 *
 * Privacy: NO external API calls. Model runs on private mesh only.
 */

const OLLAMA_ENDPOINT = 'http://100.108.198.69:11434/v1/chat/completions'
const MODEL = 'qwen3-vl:4b'

export interface OcrExtraction {
  fullName: string
  dob: string
  address: string
  licenseNum: string
}

export interface OcrResult {
  success: boolean
  fields?: OcrExtraction
  error?: string
}

function parseFields(text: string): OcrExtraction {
  const def: OcrExtraction = { fullName: '', dob: '', address: '', licenseNum: '' }

  const nameMatch = text.match(/fullName[:\s]+(.+)/i)
  if (nameMatch) def.fullName = nameMatch[1].trim()

  const dobMatch = text.match(/dob[:\s]+(.+)/i)
  if (dobMatch) def.dob = dobMatch[1].trim()

  const addrMatch = text.match(/address[:\s]+(.+)/i)
  if (addrMatch) def.address = addrMatch[1].trim()

  const licMatch = text.match(/licenseNum[:\s]+(.+)/i)
  if (licMatch) def.licenseNum = licMatch[1].trim()

  return def
}

export async function extractFromImage(imageBase64: string, mimeType: string): Promise<OcrResult> {
  try {
    const prompt = `Extract the following fields from this driver's license image and return them in plain text format:
fullName: <value>
dob: <value>
address: <value>
licenseNum: <value>

Only return the extracted fields. If a field is not visible, leave the value empty.`

    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      return { success: false, error: `Ollama returned ${response.status}` }
    }

    const data: any = await response.json()
    const text = data?.choices?.[0]?.message?.content || ''

    if (!text.trim()) {
      return { success: false, error: 'Empty response from model' }
    }

    const fields = parseFields(text)
    const hasAnyField = fields.fullName || fields.dob || fields.address || fields.licenseNum

    if (!hasAnyField) {
      return { success: false, error: 'No fields could be extracted from the image' }
    }

    return { success: true, fields }
  } catch (err: any) {
    return { success: false, error: err?.message || 'OCR extraction failed' }
  }
}
