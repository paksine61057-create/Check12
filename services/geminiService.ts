
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
    
    // ปรับปรุง System Instruction ให้เด็ดขาดและลดภาระการคิดที่ซับซ้อนเกินไป (Reasoning) เพื่อความเสถียร
    const systemInstruction = isKey 
      ? `คุณคือ OMR Scanner หน้าที่: อ่าน "ใบเฉลย" ข้อ 1-${totalQuestions} ตรวจจับรอยที่ชัดเจนที่สุด คืนค่า JSON: { "questions": [{"id":1,"marked":"ก"}] } เท่านั้น ห้ามเขียนคำบรรยาย`
      : `คุณคือ OMR Scanner หน้าที่: อ่าน "กระดาษคำตอบ" ข้อ 1-${totalQuestions} ตรวจจับรอย กากบาท, ขีดถูก หรือระบาย (รวมถึงรอยที่แก้ไขแล้ว) อ่านเลขที่และชื่อนักเรียน คืนค่า JSON: { "studentNumber":"...", "studentName":"...", "questions": [{"id":1,"marked":"ก"}] } ต้องมีข้อมูลครบทุกข้อจาก 1-${totalQuestions}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey 
            ? `Identify markings for keys 1 to ${totalQuestions}.` 
            : `Scan student sheet. Analyze marks for questions 1 to ${totalQuestions}. Be precise with faint marks.` 
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // เพิ่มความยืดหยุ่นเล็กน้อยเพื่อให้ Vision ทำงานได้เสถียรขึ้นในภาพเดิม
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 1024 }, // ปรับลดเพื่อลดโอกาสเกิด Timeout หรือ Reasoning Error
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
    if (!responseText) {
      throw new Error("AI returned no content");
    }
    
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
    console.error("OMR Detailed Error:", err);
    // หากเกิด Error ซ้ำเดิม ให้แจ้งเตือนโดยแนะนำวิธีแก้ที่ปฏิบัติได้จริง
    return { 
      answers: [], 
      error: "การเชื่อมต่อ AI ติดขัดชั่วคราว หรือภาพมีความสว่างไม่พอ (AI Inference Error) กรุณากดลองอีกครั้งหรือปรับมุมกล้อง", 
      isAuthError: err.message?.includes("401") 
    };
  }
};
