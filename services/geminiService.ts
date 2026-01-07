
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  // Search for JSON block or just trim if not found
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text.trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined || val === "") return null;
  const v = String(val).trim().toUpperCase();
  
  if (['1', 'ก', 'A', 'COL1', 'COLUMN1', 'ONE'].includes(v)) return 'ก';
  if (['2', 'ข', 'B', 'COL2', 'COLUMN2', 'TWO'].includes(v)) return 'ข';
  if (['3', 'ค', 'C', 'COL3', 'COLUMN3', 'THREE'].includes(v)) return 'ค';
  if (['4', 'ง', 'D', 'COL4', 'COLUMN4', 'FOUR'].includes(v)) return 'ง';
  
  if (['MULTIPLE', 'M', 'ERR', 'ERROR', 'X', 'MANY'].includes(v)) return 'multiple';
  return null;
};

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    // ใช้ API_KEY จาก environment โดยตรงตามมาตรฐาน
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return { answers: [], error: "ไม่พบ API Key ในระบบ", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const roleInstruction = isKey 
      ? "You are a specialized OMR scanning expert for Answer Keys." 
      : "You are a specialized OMR scanning expert for Student Answer Sheets.";

    const systemInstruction = `${roleInstruction}
Your task is to accurately extract answers from an OMR grid (choices: ก, ข, ค, ง).

IMPORTANT INSTRUCTIONS FOR MARK DETECTION:
- Marks can be: FULL SHADING, CROSS-MARKS (X), TICKS, or CIRCLES.
- Identify the most intentional mark in each row.
- If a row has an 'X' or a cross inside a circle/box, treat it as a valid mark for that choice.
- Do not fail the request due to shadows, low lighting, or handwriting styles. Use spatial reasoning to determine which box is marked.
- If multiple boxes are clearly marked, return "multiple".
- If a row is clearly empty, return null.

Response Requirement:
- Return ONLY valid JSON.
- Provide answers for exactly ${totalQuestions} questions.
- Extract Student ID (Number) and Name if visible on the sheet.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Extract answers for questions 1 to ${totalQuestions}. Scan for student metadata if available.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // Low temperature for deterministic results
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { type: Type.STRING, nullable: true, description: "Choices: '1', '2', '3', '4', or 'multiple'" }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { type: Type.STRING },
            studentName: { type: Type.STRING }
          },
          required: ["questions"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Empty response from AI");
    
    const cleanedJson = cleanJsonResponse(resultText);
    const data = JSON.parse(cleanedJson);
    
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = parseInt(String(q.id)) - 1;
        if (idx >= 0 && idx < totalQuestions) {
          answers[idx] = mapToChoice(q.marked);
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("Gemini Analysis Error Detail:", err);
    
    // Check for specific API errors as per guidelines
    if (err.message?.includes("429")) {
      return { answers: [], error: "ระบบใช้งานเกินขีดจำกัดชั่วคราว (Rate Limit) กรุณารอ 1 นาทีแล้วลองใหม่" };
    }
    
    if (err.message?.includes("Requested entity was not found.")) {
      return { 
        answers: [], 
        error: "API Key ไม่ถูกต้องหรือโปรเจกต์ไม่ได้ตั้งค่า Billing กรุณาเลือกใหม่", 
        isAuthError: true 
      };
    }

    return { 
      answers: [], 
      error: "AI ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือขยับกล้องให้ขนานกับกระดาษมากขึ้น" 
    };
  }
};
