
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
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

/**
 * Analyzes an OMR answer sheet image using Gemini 3 Flash.
 */
export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false,
  customApiKey?: string // รองรับการรับ Key จาก UI
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    // ใช้ Custom Key จาก UI หากมี มิฉะนั้นใช้จาก Environment
    const apiKey = customApiKey || process.env.API_KEY;
    
    if (!apiKey) {
      return { 
        answers: [], 
        error: "ยังไม่ได้ตั้งค่า API Key กรุณากรอกรหัสในเมนูตั้งค่า", 
        isAuthError: true 
      };
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
- If multiple boxes are clearly marked, return "multiple".
- If a row is clearly empty, return null.

Response Requirement:
- Return ONLY valid JSON.
- Provide answers for exactly ${totalQuestions} questions.`;

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
        temperature: 0.1,
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
                  marked: { type: Type.STRING, nullable: true }
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
    if (err.message?.includes("401") || err.message?.includes("key") || err.message?.includes("not found")) {
      return { 
        answers: [], 
        error: "API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน (Auth Error)", 
        isAuthError: true 
      };
    }
    return { answers: [], error: "AI ประมวลผลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
};
