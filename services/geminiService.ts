
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
  // ค้นหา JSON block โดยละเอียด
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  
  // รองรับการ Map ทุกรูปแบบที่ AI อาจจะส่งมา
  if (['1', 'ก', 'A', 'COL1', 'COLUMN1', 'ONE'].includes(v)) return 'ก';
  if (['2', 'ข', 'B', 'COL2', 'COLUMN2', 'TWO'].includes(v)) return 'ข';
  if (['3', 'ค', 'C', 'COL3', 'COLUMN3', 'THREE'].includes(v)) return 'ค';
  if (['4', 'ง', 'D', 'COL4', 'COLUMN4', 'FOUR'].includes(v)) return 'ง';
  
  if (['MULTIPLE', 'M', 'ERR', 'ERROR', 'X'].includes(v)) return 'multiple';
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
    
    // คำสั่งที่เน้นการทำงานแบบ Pixel-based detection มากกว่าการอ่านค่าเชิงความหมาย
    const systemInstruction = `Extract markings from OMR grid image.
Instructions:
1. Scan ${totalQuestions} rows.
2. In each row, there are 4 positions (1, 2, 3, 4).
3. Return the index (1-4) that is shaded or marked.
4. Output strict JSON.
Format: {"questions": [{"id": 1, "marked": "1"}]${!isKey ? ', "studentNumber": "ID", "studentName": "Name"' : ''}}
If no mark, "marked" is null. If multiple marks, "marked" is "multiple".`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Identify marks for 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0, // สำคัญมาก: ปรับเป็น 0 เพื่อความแม่นยำสูงสุดและลด Error
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

    if (!response || !response.text) {
      throw new Error("No response");
    }
    
    const text = response.text;
    const cleanData = cleanJsonResponse(text);
    const data = JSON.parse(cleanData);
    
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
    console.error("AI Scan Error:", err);
    return { 
      answers: [], 
      error: "AI เข้าใจภาพไม่สำเร็จ กรุณาจัดวางกระดาษให้ตรง และระวังอย่าให้มีเงาดำพาดทับจุดฝน แล้วลองกดใหม่อีกครั้ง" 
    };
  }
};
