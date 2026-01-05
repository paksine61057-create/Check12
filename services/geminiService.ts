
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
    
    // ปรับปรุง Instruction ให้มีความฉลาดในการวิเคราะห์ร่องรอยมากขึ้น
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญ OMR วิเคราะห์ "ใบเฉลย" ข้อ 1-${totalQuestions} ตรวจจับรอย กากบาท (X), ขีดถูก, หรือการระบายอย่างแม่นยำ คืน JSON: { "questions": [{"id":1,"marked":"ก"}] } ต้องครบ ${totalQuestions} ข้อ ห้ามสรุปว่าว่างหากมีร่องรอยการเขียน`
      : `คุณคือระบบตรวจข้อสอบ OMR ขั้นสูง หน้าที่ของคุณคือวิเคราะห์กระดาษคำตอบนักเรียนข้อ 1-${totalQuestions} อย่างละเอียดที่สุด ตรวจจับร่องรอยการเขียนทุกชนิด (กากบาท X, ขีดถูก, ระบาย) หากมีการแก้ไข (เช่น กากบาททับรอยระบายเดิม) ให้วิเคราะห์เจตนาและเลือกคำตอบล่าสุด อ่านเลขที่และชื่อจากส่วนหัว คืน JSON: { "studentNumber":"...", "studentName":"...", "questions": [{"id":1,"marked":"ก"}] } ต้องส่งค่ากลับมาให้ครบทุกข้อ ห้ามตกหล่น`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey 
            ? `Perform high-precision OMR scan for answer keys 1 to ${totalQuestions}. Focus on intentional marks.` 
            : `Scan student details and analyze markings for questions 1 to ${totalQuestions}. Be sensitive to faint marks and handle corrections intelligently. Ensure every question ID is present in the output.` 
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        // เพิ่ม Thinking Budget เป็น 2048 เพื่อให้ AI มีเวลาวิเคราะห์ภาพที่ซับซ้อนหรือรอยจางๆ ได้ดีขึ้น
        thinkingConfig: { thinkingBudget: 2048 }, 
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
    return { answers: [], error: "การวิเคราะห์ร่องรอยขัดข้อง (AI Reasoning Error) กรุณาลองถ่ายภาพในที่สว่างขึ้นหรือลองใหม่อีกครั้ง", isAuthError: err.message?.includes("401") };
  }
};
