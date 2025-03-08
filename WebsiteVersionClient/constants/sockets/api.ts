import io from 'socket.io-client';
import URL from '~/constants/URL';

export const socket = io(URL as string);
