import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

const QUESTDB_URL = env.VITE_API_BASE_URL || 'https://quest.justpi.tech';

export async function GET({ url }) {
	try {
		const query = url.searchParams.get('query');
		
		if (!query) {
			return json({ error: 'Query parameter is required' }, { status: 400 });
		}

		console.log('Server: Executing query:', query);
		
		const questUrl = `${QUESTDB_URL}/exec?query=${encodeURIComponent(query)}`;
		console.log('Server: Fetching from:', questUrl);
		
		const response = await fetch(questUrl);
		
		if (!response.ok) {
			throw new Error(`QuestDB returned ${response.status}`);
		}
		
		const data = await response.json();
		console.log('Server: QuestDB response:', data);
		
		return json(data);
		
	} catch (error) {
		console.error('Server: Error fetching from QuestDB:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
