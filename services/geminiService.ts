
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
  // ค้นหาตำแหน่งปีกกาเปิดและปิดเพื่อให้แน่ใจว่าได้เฉพาะส่วน JSON
  const firstOpen = text.indexOf('{');
  const lastClose = text.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    return text.substring(firstOpen, lastClose + 1);
  }
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  
  // รองรับทั้งแบบตัวเลขตำแหน่ง (1-4) และตัวอักษรไทย/อังกฤษ
  if (['1', 'ก', 'A', 'COL1', 'COLUMN1'].includes(v)) return 'ก';
  if (['2', 'ข', 'B', 'COL2', 'COLUMN2'].includes(v)) return 'ข';
  if (['3', 'ค', 'C', 'COL3', 'COLUMN3'].includes(v)) return 'ค';
  if (['4', 'ง', 'D', 'COL4', 'COLUMN4'].includes(v)) return 'ง';
  
  if (['MULTIPLE', 'M', 'ERR', 'ERROR'].includes(v)) return 'multiple';
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
    
    // ปรับ Prompt ให้เป็นลักษณะคำสั่งแบบเด็ดขาด (Deterministic) เพื่อลดการตีความที่ผิดพลาด
    const systemInstruction = `You are a robotic OMR grid scanner.
Objective: Extract marked answers for ${totalQuestions} questions from the provided image.
Grid Structure: Each question is a horizontal row with 4 choice bubbles: 1=ก, 2=ข, 3=ค, 4=ง.
Action: Identify which bubble index (1, 2, 3, or 4) is marked (ticked/shaded) for each question ID.
Output: Strict JSON object only.
Format: {"questions": [{"id": 1, "marked": "1"}]${!isKey ? ', "studentNumber": "string", "studentName": "string"' : ''}}
If no mark is found for a question, set "marked" to null.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Scan the OMR sheet and return answers for questions 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // ปรับค่าเล็กน้อยเพื่อความยืดหยุ่นในการอ่านภาพที่เบลอเล็กน้อย
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

    // ตรวจสอบความสมบูรณ์ของ Response
    if (!response || !response.text) {
      throw new Error("No response from AI");
    }
    
    const text = response.text;
    const cleanData = cleanJsonResponse(text);
    const data = JSON.parse(cleanData);
    
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = parseInt(q.id) - 1;
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
    console.error("Gemini Analysis Failure:", err);
    // กรณี Error จาก JSON หรือ API ให้ส่ง Error ที่สื่อสารให้ผู้ใช้เข้าใจง่ายขึ้น
    return { 
      answers: [], 
      error: "ระบบประมวลผลขัดข้อง (AI Inference Error) กรุณากดปุ่มสแกนใหม่อีกครั้ง หรือถ่ายภาพโดยให้แผ่นกระดาษเรียบที่สุด" 
    };
  }
};
