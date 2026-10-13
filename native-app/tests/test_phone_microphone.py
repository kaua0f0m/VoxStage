import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from phone_microphone import PhoneMicrophone

class RelayTests(unittest.TestCase):
    def setUp(self):
        self.relay=PhoneMicrophone()
        self.session=str(uuid4())
        self.sender=str(uuid4())
        self.relay.configure({'session':self.session,'epoch':4,'active':True})
    def packet(self, sequence=1, **changes):
        return dict(session=self.session,epoch=4,sender=self.sender,sequence=sequence,frequency=440,confidence=.95,rms=.2,capturedAt=self.relay.now(),**changes)
    def test_pitch_only_bounded_duplicate_and_lease(self):
        for index in range(80):self.relay.receive(self.packet(index))
        data=self.relay.drain()
        self.assertTrue(data['ready'])
        self.assertEqual(len(data['frames']),64)
        self.relay.receive(self.packet(79))
        self.assertEqual(self.relay.drain()['frames'],[])
        self.assertNotIn('pcm',data['frames'][0])
        body=self.packet(81);body['sender']=str(uuid4())
        with self.assertRaises(ValueError):self.relay.receive(body)
    def test_epoch_stop_and_clock_guards(self):
        for name,value in [('session',str(uuid4())),('epoch',5),('frequency',float('nan')),('rms',8),('capturedAt',self.relay.now()-2000)]:
            body=self.packet();body[name]=value
            with self.assertRaises(ValueError):self.relay.receive(body)
        self.relay.receive(self.packet())
        self.relay.configure({'session':self.session,'epoch':5,'active':True})
        self.assertEqual(self.relay.drain()['frames'],[])
        self.relay.configure({'session':None})
        with self.assertRaises(ValueError):self.relay.receive(self.packet())
    def test_host_and_phone_expire(self):
        clock=self.relay.now()
        with patch.object(self.relay,'now',return_value=clock+4000):
            self.assertFalse(self.relay.status()['active'])
            self.assertFalse(self.relay.drain()['ready'])
            with self.assertRaises(ValueError):self.relay.receive(self.packet())

if __name__=='__main__':unittest.main()
