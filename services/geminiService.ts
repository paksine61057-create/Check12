
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

// ฟังก์ชันแปลงค่าคำตอบจาก AI ให้เป็นมาตรฐาน ก ข ค ง รองรับทั้งไทย อังกฤษ และตัวเลข
const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  // กรณีระบุเป็น ก-ง
  if (v === 'ก' || v === 'A' || v === '1') return 'ก';
  if (v === 'ข' || v === 'B' || v === '2') return 'ข';
  if (v === 'ค' || v === 'C' || v === '3') return 'ค';
  if (v === 'ง' || v === 'D' || v === '4') return 'ง';
  // กรณีระบุหลายข้อ
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
    
    // ปรับปรุง Instruction ให้เข้มงวดเรื่องจำนวนข้อและรูปแบบคำตอบ
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญ OMR วิเคราะห์ "ใบเฉลย" ข้อ 1-${totalQuestions} ตรวจจับรอย กากบาท (X), ขีดถูก, หรือการระบาย คืน JSON: { "questions": [{"id":1,"marked":"ก"}] } ห้ามข้ามข้อเด็ดขาด ต้องครบ ${totalQuestions} ข้อ`
      : `คุณคือระบบตรวจข้อสอบอัจฉริยะ อ่านรหัสคำตอบนักเรียนข้อ 1-${totalQuestions} (ก, ข, ค, ง) พร้อมอ่านเลขที่และชื่อ คืน JSON: { "studentNumber":"...", "studentName":"...", "questions": [{"id":1,"marked":"ก"}] } ต้องคืนค่าให้ครบทุกข้อจาก 1 ถึง ${totalQuestions} หากไม่เห็นรอยให้ใส่ null`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey 
            ? `Extract all answers for keys 1 to ${totalQuestions}. Focus on any markings (circles, crosses, or checks).` 
            : `Identify student info and ALL answers for questions 1 to ${totalQuestions}. Use 'ก', 'ข', 'ค', 'ง' for choices. Scan carefully for any marks like X or ✓.` 
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
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
          // ใช้ฟังก์ชัน mapToChoice เพื่อความยืดหยุ่นในการรับค่าจาก AI
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
    console.error("OMR Service Error:", err);
    return { answers: [], error: "ไม่สามารถวิเคราะห์ร่องรอยคำตอบได้ กรุณาลองถ่ายภาพให้ชัดเจนขึ้น", isAuthError: err.message?.includes("401") };
  }
};
