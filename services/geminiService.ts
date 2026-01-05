
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
  if (v === 'ก' || v === 'A' || v === '1') return 'ก';
  if (v === 'ข' || v === 'B' || v === '2') return 'ข';
  if (v === 'ค' || v === 'C' || v === '3') return 'ค';
  if (v === 'ง' || v === 'D' || v === '4') return 'ง';
  if (v === 'MULTIPLE' || v === 'หลายข้อ' || v === 'M') return 'multiple';
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
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อนใช้งาน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // ปรับ Instruction ให้กระชับที่สุดเพื่อลดการเกิด Reasoning Error
    const systemInstruction = isKey 
      ? `You are an OMR scanner for answer keys (1-${totalQuestions}). Detect all marks. Return JSON: { "questions": [{"id":1,"marked":"ก"}] }`
      : `You are an OMR scanner for student sheets (1-${totalQuestions}). Detect student ID, name, and marks. Return JSON: { "studentNumber":"...", "studentName":"...", "questions": [{"id":1,"marked":"ก"}] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // ใช้ Flash ซึ่งเสถียรกว่ามากในงาน Vision-to-JSON
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Extract answers 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        // ถอด thinkingConfig ออกเพื่อให้ใช้ Native Vision mode ลดโอกาส Error
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

    const responseText = response.text;
    if (!responseText) throw new Error("No Content");
    
    const data = JSON.parse(cleanJsonResponse(responseText));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
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
    console.error("OMR Error:", err);
    return { 
      answers: [], 
      error: "ระบบขัดข้องชั่วคราว (AI Error) กรุณากดปุ่มตรวจใหม่อีกครั้งเพื่อเริ่มการสแกนใหม่", 
      isAuthError: err.message?.includes("401") || err.message?.includes("API_KEY")
    };
  }
};
