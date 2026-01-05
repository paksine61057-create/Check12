
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
    
    // ปรับปรุง Instruction ให้ตรวจจับร่องรอยการเขียนทุกรูปแบบ (กากบาท, ขีดถูก, ระบาย)
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญ OMR วิเคราะห์ "ใบเฉลย" ข้อ 1-${totalQuestions} ตรวจจับรหัสคำตอบจากการ กากบาท (X), ขีดถูก, หรือการระบายในช่องวงกลม หากมีการขีดเขียนในช่องใดให้ถือเป็นเฉลยข้อนั้น คืน JSON: { "questions": [{"id":1,"marked":"ก"}] }`
      : `คุณคือระบบตรวจข้อสอบอัจฉริยะ ตรวจร่องรอยการเลือกคำตอบนักเรียนข้อ 1-${totalQuestions} รองรับทั้งการกากบาท (X), ขีดถูก (Check), หรือการระบาย คืน JSON: { "studentNumber":"...", "studentName":"...", "questions":[] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey 
            ? `Identify all marked answers (circles, crosses, or checks) for keys 1 to ${totalQuestions}.` 
            : `Detect student identity and all marks (crosses, checks, or filled bubbles) for answers 1 to ${totalQuestions}.` 
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        // ให้ Thinking Budget เล็กน้อยเพื่อให้ AI วิเคราะห์ "เจตนา" ของรอยขีดเขียนได้ดีขึ้น
        thinkingConfig: { thinkingBudget: 512 }, 
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

    if (!response.text) throw new Error("AI Timeout");
    
    const data = JSON.parse(cleanJsonResponse(response.text));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) {
          const val = q.marked;
          if (['ก', 'ข', 'ค', 'ง', 'multiple'].includes(val)) {
            answers[idx] = val as Choice;
          } else {
            answers[idx] = null;
          }
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("OMR Service Error:", err);
    return { answers: [], error: "ไม่สามารถวิเคราะห์ร่องรอยคำตอบได้ กรุณาลองถ่ายภาพให้ชัดเจนขึ้น", isAuthError: err.message?.includes("401") };
  }
};
