
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "";
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
  } catch (e) {
    console.error("Regex error in cleanJsonResponse", e);
  }
  return (text || "").trim();
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
  isKey: boolean = false,
  customApiKey?: string
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    const apiKey = customApiKey || process.env.API_KEY;
    
    if (!apiKey || apiKey.trim().length < 5) {
      return { 
        answers: [], 
        error: "กรุณาตั้งค่า API Key ก่อนเริ่มใช้งาน", 
        isAuthError: true 
      };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    let imageData = base64Image;
    if (typeof base64Image === 'string' && base64Image.includes(',')) {
      imageData = base64Image.split(',')[1];
    } else if (typeof base64Image !== 'string') {
      throw new Error("Invalid image format");
    }

    const roleInstruction = isKey 
      ? "คุณคือผู้เชี่ยวชาญด้านการตรวจใบเฉลย (Answer Key)" 
      : "คุณคือผู้เชี่ยวชาญด้านการตรวจกระดาษคำตอบนักเรียน";

    const systemInstruction = `${roleInstruction}
หน้าที่ของคุณคืออ่านจุดที่ถูกฝน (ก, ข, ค, ง) จากรูปภาพ
กฎสำคัญ:
- ถ้าฝนหลายช่องในข้อเดียว ให้ตอบ "multiple"
- ถ้าไม่ได้ฝนเลย ให้ตอบ null
- ตอบกลับเป็น JSON เท่านั้น
- ต้องมีข้อมูลครบทั้ง ${totalQuestions} ข้อ โดยระบุเลขข้อ q: 1 ถึง ${totalQuestions}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: imageData } },
          { text: `Extract answers for items 1 to ${totalQuestions}. Also identify student ID and name if present.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  q: { type: Type.INTEGER },
                  val: { type: Type.STRING }
                },
                required: ["q", "val"]
              }
            },
            id: { type: Type.STRING },
            name: { type: Type.STRING }
          },
          required: ["answers"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("AI ไม่ส่งข้อมูลกลับมา");
    
    const cleanedJson = cleanJsonResponse(resultText);
    let data: any;
    try {
      data = JSON.parse(cleanedJson);
    } catch (parseErr) {
      throw new Error("AI ส่งข้อมูลผิดรูปแบบ (Invalid JSON)");
    }
    
    if (!data || typeof data !== 'object' || !Array.isArray(data.answers)) {
      throw new Error("โครงสร้างข้อมูลจาก AI ไม่ถูกต้อง");
    }

    const finalAnswers: Choice[] = new Array(totalQuestions).fill(null);
    
    data.answers.forEach((item: any) => {
      if (item && item.q !== undefined) {
        const qNum = Number(item.q);
        const idx = qNum - 1;
        if (!isNaN(idx) && idx >= 0 && idx < totalQuestions) {
          finalAnswers[idx] = mapToChoice(item.val);
        }
      }
    });

    return {
      answers: finalAnswers,
      studentId: data.id ? String(data.id) : "",
      studentName: data.name ? String(data.name) : ""
    };
  } catch (err: any) {
    console.error("Gemini Service Error:", err);
    let msg = err.message || "Unknown error";
    
    if (msg.includes("401") || msg.includes("API_KEY_INVALID")) {
      return { answers: [], error: "API Key ไม่ถูกต้อง", isAuthError: true };
    }
    if (msg.includes("429")) {
      return { answers: [], error: "โควต้าเต็มแล้ว (Rate limit) กรุณารอสักครู่" };
    }
    
    // ป้องกัน "Type error" ข้อความห้วนๆ ให้แสดงคำอธิบายที่ชัดเจนขึ้น
    if (msg.toLowerCase().includes("type error") || msg.toLowerCase().includes("typeerror")) {
      msg = "ข้อมูลจาก AI ไม่สมบูรณ์หรือผิดประเภท";
    }
    
    return { answers: [], error: `เกิดข้อผิดพลาด: ${msg}` };
  }
};
