
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "";
  // ค้นหาขอบเขตของ JSON ในข้อความที่ส่งกลับมา
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
    
    // เตรียมข้อมูลภาพ (เช็คว่ามี Header หรือไม่)
    let imageData = base64Image;
    if (base64Image.includes(',')) {
      imageData = base64Image.split(',')[1];
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
- ต้องมีข้อมูลครบทั้ง ${totalQuestions} ข้อ`;

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
                  q: { type: Type.INTEGER, description: "Question number" },
                  val: { type: Type.STRING, description: "Marked choice (ก,ข,ค,ง,multiple,null)" }
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
    if (!resultText) throw new Error("AI ไม่ส่งข้อมูลข้อความกลับมา");
    
    const cleanedJson = cleanJsonResponse(resultText);
    const data = JSON.parse(cleanedJson);
    
    // ตรวจสอบว่า data.answers มีอยู่จริงและเป็น Array หรือไม่ (ป้องกัน Type error)
    if (!data || !Array.isArray(data.answers)) {
      throw new Error("โครงสร้างข้อมูลที่ AI ส่งกลับมาไม่ถูกต้อง (Missing answers array)");
    }

    const finalAnswers: Choice[] = new Array(totalQuestions).fill(null);
    
    data.answers.forEach((item: any) => {
      if (item && typeof item.q === 'number') {
        const idx = item.q - 1;
        if (idx >= 0 && idx < totalQuestions) {
          finalAnswers[idx] = mapToChoice(item.val);
        }
      }
    });

    return {
      answers: finalAnswers,
      studentId: data.id || "",
      studentName: data.name || ""
    };
  } catch (err: any) {
    console.error("Gemini Service Error:", err);
    const msg = err.message || "Unknown error";
    
    if (msg.includes("401") || msg.includes("API_KEY_INVALID") || msg.includes("not found")) {
      return { answers: [], error: "API Key ไม่ถูกต้อง", isAuthError: true };
    }
    if (msg.includes("429")) {
      return { answers: [], error: "โควต้าเต็มแล้ว (Rate limit) กรุณารอสักครู่" };
    }
    
    // ส่งข้อความ Error ที่อ่านง่ายขึ้นกลับไป
    return { answers: [], error: `เกิดข้อผิดพลาด: ${msg.includes("JSON") ? "AI ส่งข้อมูลผิดรูปแบบ" : msg}` };
  }
};
