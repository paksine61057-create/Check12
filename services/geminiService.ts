
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const getSafeApiKey = (): string => {
  let key = "";
  try {
    const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
    const windowKey = (window as any).API_KEY || "";
    const manualKey = localStorage.getItem('manual_api_key') || "";
    key = envKey || windowKey || manualKey || "";
  } catch (e) {
    key = localStorage.getItem('manual_api_key') || (window as any).API_KEY || "";
  }
  return key.toString().trim().replace(/^['"]|['"]$/g, '');
};

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.substring(start, end + 1);
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  // แมปตามตำแหน่งคอลัมน์ หรือตัวอักษร
  if (v === '1' || v === 'ก' || v === 'A' || v === 'COL1') return 'ก';
  if (v === '2' || v === 'ข' || v === 'B' || v === 'COL2') return 'ข';
  if (v === '3' || v === 'ค' || v === 'C' || v === '3') return 'ค';
  if (v === '4' || v === 'ง' || v === 'D' || v === '4') return 'ง';
  if (v === 'MULTIPLE' || v === 'M') return 'multiple';
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
    const apiKey = getSafeApiKey();
    if (!apiKey || apiKey.length < 5) {
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Prompt ที่กระชับและเน้นโครงสร้างตาราง
    const systemInstruction = `You are a specialized OMR scanner.
Task: Scan a grid of ${totalQuestions} questions.
Layout: Each row is a question. Each row has 4 horizontal columns (1=ก, 2=ข, 3=ค, 4=ง).
Goal: For each row, identify which column index (1, 2, 3, or 4) has a mark.
Output: Valid JSON only.
Format: {"questions": [{"id": 1, "marked": "1"}]${!isKey ? ', "studentNumber": "...", "studentName": "..."' : ''}}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Detect markings for questions 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
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

    const text = response.text;
    if (!text) throw new Error("Empty response");
    
    const data = JSON.parse(cleanJsonResponse(text));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) answers[idx] = mapToChoice(q.marked);
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("Gemini Error:", err);
    return { 
      answers: [], 
      error: "AI ขัดข้องชั่วคราว กรุณาตรวจสอบว่าภาพชัดเจนและไม่มีเงาบัง แล้วกดลองใหม่อีกครั้ง" 
    };
  }
};
